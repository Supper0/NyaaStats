import axios from 'axios';
import bignum from 'bignum';
import NBT from 'mcnbt';
import path from 'path';
import yaml from 'js-yaml';
import fs from 'fs-extra';

import { writeJSON, mergeStats, defaultSkin, download, delay } from './helper';
import * as logger from './logger';

export default class Utils {
  constructor() {
    this.config = Utils.loadConfig();
    this.apiLimited = false;
  }

  getConfig() {
    return this.config;
  }

  static loadConfig() {
    let config;
    try {
      config = yaml.safeLoad(fs.readFileSync('./config.yml'), 'utf8');
    } catch (e) {
      logger.Config.error(e);
      process.exit(1);
    }
    config.BASEPATH = path.parse(path.resolve('./config.yml')).dir;
    return config;
  }

  getWorldTime() {
    const nbt = new NBT();
    return new Promise((resolve, reject) => {
      nbt.loadFromZlibCompressedFile(
        path.join(this.config.render.level),
        (err) => {
          if (err) return reject(err);
          return resolve(bignum(nbt.select('').select('Data').select('Time').getValue()).toNumber() / 20);
        },
      );
    });
  }

  getAllPlayers() {
    const uuids = [];
    const r = new RegExp(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    fs.readdirSync(path.join(this.config.render.playerdata)).forEach((f) => {
      const uuid = path.basename(f, '.dat');
      // filter out old player usernames.
      if (r.test(uuid)) {
        uuids.push(uuid);
      }
    });
    return uuids;
  }

  getWhitelistedPlayers() {
    const uuids = [];
    JSON.parse(fs.readFileSync(this.config.render.whitelist, 'utf8')).forEach((p) => {
      uuids.push(p.uuid);
    });
    return uuids;
  }

  getBannedPlayers() {
    const banlist = [];
    const banned = JSON.parse(fs.readFileSync(path.join(this.config.render['banned-players']), 'utf8'));
    banned.forEach((ban) => {
      banlist.push(ban.uuid);
    });
    return banlist;
  }

  getPlayerState(uuid) {
    return new Promise((resolve, reject) => {
      if (!this.config.render.stats) return reject();
      const statsfile = path.join(this.config.render.stats, `${uuid}.json`);
      let data;
      try {
        data = fs.readFileSync(statsfile);
      } catch (error) {
        logger.PlayerData.warn('READ', statsfile, error);
        return reject();
      }
      logger.PlayerData.info('READ', statsfile);
      data = JSON.parse(data);
      return resolve({
        merged: mergeStats(data),
        source: data
      });
    });
  }

  getPlayerAdvancements(uuid) {
    return new Promise((resolve, reject) => {
      // compatible to 1.11
      if (!this.config.render.advancements) return reject();
      const advancementsfile = path.join(this.config.render.advancements, `${uuid}.json`);

      let data;
      try {
        data = fs.readFileSync(advancementsfile);
      } catch (error) {
        logger.PlayerData.warn('READ', advancementsfile, error);
        return reject();
      }
      logger.PlayerData.info('READ', advancementsfile);
      return resolve(JSON.parse(data));
    });
  }

  getPlayerData(uuid) {
    const datafile = path.join(this.config.render.playerdata, `${uuid}.dat`);
    return new Promise((resolve, reject) => {
      const nbt = new NBT();
      nbt.loadFromZlibCompressedFile(datafile, async (err) => {
        if (err) {
          logger.PlayerData.warn('READ', datafile, err);
          return reject();
        }
        logger.PlayerData.info('READ', datafile);
        const uuidShort = uuid.replace(/-/g, '');
        let history;
        try {
          history = await this.getNameHistory(uuidShort);
        } catch (error) {
          return reject();
        }
        if (history && history[0]) {
          let lived = '';
          if (nbt.select('').select('Spigot.ticksLived')) {
            lived = nbt.select('').select('Spigot.ticksLived').getValue() / 20;
          }
          const timeStart = bignum(nbt.select('').select('bukkit').select('firstPlayed').getValue()).toNumber();
          const timeLast = bignum(nbt.select('').select('bukkit').select('lastPlayed').getValue()).toNumber();
          const pdata = {
            seen: timeLast,
            time_start: timeStart,
            time_last: timeLast,
            time_lived: lived,
            playername: history[0].name,
            names: history,
            uuid_short: uuidShort,
            lastUpdate: (new Date()).valueOf(),
            uuid,
          };
          return resolve(pdata);
        }
        return reject();
      });
    });
  }

  async getPlayerTotalData(uuid) {
    let s;
    let stats;
    let stats_source;
    let advancements;
    let data;
    try {
      s = await this.getPlayerState(uuid);
      stats = s['merged'];
      stats_source = s['source'];
      advancements = await this.getPlayerAdvancements(uuid);
      data = await this.getPlayerData(uuid);
    } catch (error) {
      return null;
    }
    return {
      stats,
      stats_source,
      advancements,
      data,
    };
  }

  async getNameHistory(uuid) {
    const apiNameHistory = `https://api.mojang.com/user/profiles/${uuid}/names`;
    let history;
    try {
      history = await this.getMojangAPI(apiNameHistory);
    } catch (err) {
      return null;
    }
    if (!history) return null;
    // The order of the response data from Mojang API is uncertain,
    // so manually sort it (to descending order) for making sure.
    history.sort((a, b) => (b.changedToAt || 0) - (a.changedToAt || 0))
    return history;
  }

  async getMojangAPI(apiPath) {
    if (this.config.api.ratelimit && this.apiLimited) {
      await delay(10);
      return this.getMojangAPI(apiPath);
    }
    this.apiLimited = true;
    logger.MojangAPI.info('REQUEST', apiPath);

    let body;
    try {
      const res = await axios.get(apiPath, {timeout: 30000 /* 30 secs */})
      body  = res.data
    } catch (err) {
      logger.MojangAPI.error('REQUEST', apiPath, err.toJSON());
      setTimeout(() => {
        this.apiLimited = false;
      }, this.config.api.ratelimit * 3000);
      throw new Error(err.toJSON());
    }

    setTimeout(() => {
      this.apiLimited = false;
    }, this.config.api.ratelimit * 1000);

    return body;
  }

  static getPlayerAssets(uuid, playerpath) {
    try {
      fs.ensureDirSync(playerpath);
    } catch (error) {
      throw new Error(error);
    }

    const apiPrefixAvatar = 'https://crafatar.com/avatars/';
    const apiPrefixBody = 'https://crafatar.com/renders/body/';
    const apiPrefixSkin = 'https://crafatar.com/skins/';

    const slim = `&default=MHF_${defaultSkin(uuid)}`;

    download(
      `${apiPrefixAvatar}${uuid}?size=64&overlay${slim}`,
      path.join(playerpath, 'avatar.png'),
    );
    download(
      `${apiPrefixBody}${uuid}?size=128&overlay${slim}`,
      path.join(playerpath, 'body.png'),
    );
    download(
      `${apiPrefixSkin}${uuid}?${slim}`,
      path.join(playerpath, 'skin.png'),
    );
  }

  createPlayerData(uuid, banned = false) {
    return new Promise(async (resolve, reject) => {
      const playerpath = path.join(this.config.render.output, uuid.replace(/-/g, ''));
      let data;
      try {
        if (fs.existsSync(path.join(playerpath, 'stats.json'))) {
          data = JSON.parse(fs.readFileSync(path.join(playerpath, 'stats.json')));
        } else {
          data = await this.getPlayerTotalData(uuid, banned);
        }
      } catch (error) {
        return reject(error);
      }
      if (fs.existsSync(path.join(playerpath, 'avatar.png') && path.join(playerpath, 'body.png'))) {
        return resolve(data);
      } else if (data && data.stats && data.data) {
        try {
          await Utils.getPlayerAssets(uuid.replace(/-/g, ''), playerpath);
        } catch (error) {
          logger.PlayerData.error('ASSETS', error);
        }
        data.data = {
          ...data.data,
          banned,
        };
        writeJSON(path.join(playerpath, 'stats.json'), data);
        return resolve(data);
      }
      return reject();
    });
  }
}
