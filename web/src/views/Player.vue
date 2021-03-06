<template>
  <div>
    <!-- Loading indicator -->
    <div v-if="!player" class="xl:w-page px-page py-10 xl:mx-auto text-center">
      <span class="tracking-widest">LOADING</span>
    </div>

    <template v-else>
      <!-- Player name (page header) -->
      <header class="xl:w-page xl:mx-auto px-page py-1.5 md:py-2 flex flex-wrap items-center">
        <h1 class="py-1.5 md:py-2 text-2xl md:text-3xl xl:text-4xl font-black" @click="$refs.iframe.contentWindow.location.reload()">{{ player.data.playername }}</h1>
        <span v-if="player.data.banned" class="mx-2 p-1 rounded bg-red-600 text-white text-sm md:text-base font-medium">BANNED</span>
        <button v-if="randomPlayerMode" class="flex-none ml-auto py-1.5 md:py-2 text-blue-600" @click="goRandom">{{ t('nyaa.general.go_random_player_again') }}</button>
      </header>

      <div class="xl:w-page xl:mx-auto md:flex md:items-start">
        <!-- Player info (aside) -->
        <div class="md:flex-none px-page pb-5">
          <!-- Player figure & membership info -->
          <div class="bg-white rounded-md shadow overflow-hidden md:w-figure md:flex-none">
            <!-- eslint-disable vue/max-attributes-per-line -->
            <iframe ref="iframe" :src="'/skin/index.html?uuid=' + uuid" scrolling="no" class="w-full h-figure border-0" />
            <dl>
              <div
                v-for="({label, value}, idx) of membership"
                :key="idx"
                class="p-3 border-t border-gray-300 flex items-center"
              >
                <dt class="text-gray-500 mr-3">{{ label }}</dt>
                <dd class="ml-auto font-tnum">{{ value }}</dd>
              </div>
            </dl>
          </div>

          <PlayerNameHistory :player="player" class="mt-5" />

          <PlayerOreGraph :player="player" class="mt-5" />
        </div>
        <!-- Main -->
        <div class="flex-1 md:mr-5 xl:ml-5 xl:mr-0 -mb-5">
          <!-- Advancements -->
          <PlayerAdvancementPanel :player="player" class="mb-5" />
          <!-- Statistics -->
          <PlayerStatisticPanel :player="player" class="mb-5" />
        </div>
      </div>
    </template>
  </div>
</template>

<script>
  import {add, formatDistanceStrict} from 'date-fns'
  import {zhCN} from 'date-fns/locale'

  import advancementData from '@/assets/advancement-data.json'
  import PlayerNameHistory from '@/components/PlayerNameHistory.vue'
  import PlayerOreGraph from '@/components/PlayerOreGraph.vue'
  import PlayerAdvancementPanel from '@/components/PlayerAdvancementPanel.vue'
  import PlayerStatisticPanel from '@/components/PlayerStatisticPanel.vue'
  import useRandomPlayer from '@/composables/random-player'
  import {normalizeDate} from '@/common/utils'

  const {state: randomPlayerState, goRandom} = useRandomPlayer()

  export default {
    name: 'PlayerView',

    components: {
      PlayerNameHistory,
      PlayerOreGraph,
      PlayerAdvancementPanel,
      PlayerStatisticPanel,
    },

    data () {
      return {
        player: null,

        goRandom,
      }
    },

    computed: {
      db: () => advancementData,

      randomPlayerMode () {
        return randomPlayerState.randomMode
      },

      uuid () {
        return this.$route.params.uuid
      },

      membership () {
        const output = [
          {
            label: this.t('nyaa.player_info.last_active'),
            value: this.formatDate(this.player?.data.time_last),
          },
          {
            label: this.t('nyaa.player_info.first_login'),
            value: this.formatDate(this.player?.data.time_start),
          },
          {
            label: this.t('nyaa.player_info.total_online'),
            value: null,
          },
        ]

        if (this.player?.data.time_lived) {
          const now = new Date()
          const base = add(now, {seconds: -this.player.data.time_lived})
          output[2].value = formatDistanceStrict(now, base, {unit: 'hour', locale: this.t.lang === 'zh_cn' ? zhCN : null})
        }

        return output
      },
    },

    watch: {
      uuid () {
        this.fetchData()
      },
    },

    created () {
      this.fetchData()
    },

    methods: {
      async fetchData () {
        this.player = null
        this.player = await this.$store.dispatch('fetchStats', this.uuid)
        document.title = `${this.player.data.playername} | ${this.$store.state.info.title}`
        this.$store.commit('setFooterUpdateTime', this.player.data.lastUpdate)
      },

      formatDate (val) {
        return val && normalizeDate(val, 'short')
      },
    },
  }
</script>

<style lang="scss" scoped>
  @screens xl {
    .w-page {
      width: 1200px;
    }
  }

  .h-figure {
    height: 300px;
  }

  @screens md {
    .w-figure {
      width: 300px;
    }
  }
</style>
