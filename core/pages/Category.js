import Vue from 'vue'
import toString from 'lodash-es/toString'

import config from 'config'
import EventBus from '@vue-storefront/core/plugins/event-bus'
import { baseFilterProductsQuery, buildFilterProductsQuery } from '@vue-storefront/store/helpers'
import { htmlDecode } from '@vue-storefront/core/filters/html-decode'
import i18n from '@vue-storefront/i18n'

import Composite from '@vue-storefront/core/mixins/composite'

export default {
  name: 'Category',
  mixins: [Composite],
  data () {
    return {
      pagination: {
        perPage: 50,
        current: 0,
        enabled: false
      },
      bottom: false,
      lazyLoadProductsOnscroll: true
    }
  },
  computed: {
    products () {
      return this.$store.state.product.list.items
    },
    productsCounter () {
      return this.$store.state.product.list.items.length
    },
    productsTotal () {
      return this.$store.state.product.list.total
    },
    currentQuery () {
      return this.$store.state.category.current_product_query
    },
    isCategoryEmpty () {
      return (!(this.$store.state.product.list.items) || this.$store.state.product.list.items.length === 0)
    },
    category () {
      return this.$store.state.category.current
    },
    categoryName () {
      return this.$store.state.category.current ? this.$store.state.category.current.name : ''
    },
    categoryId () {
      return this.$store.state.category.current ? this.$store.state.category.current.id : ''
    },
    filters () {
      return this.$store.state.category.filters
    },
    breadcrumbs () {
      return this.$store.state.category.breadcrumbs
    }
  },
  watch: {
    '$route': 'validateRoute',
    bottom (bottom) {
      if (bottom) {
        this.pullMoreProducts()
      }
    }
  },
  preAsyncData ({ store, route }) {
    console.log('preAsyncData query setup')
    store.state.category.current_product_query = {
      populateAggregations: true,
      store: store,
      route: route,
      current: 0,
      perPage: 50,
      sort: config.entities.productList.sort,
      filters: config.products.defaultFilters,
      includeFields: config.entities.optimize && Vue.prototype.$isServer ? config.entities.productList.includeFields : null,
      excludeFields: config.entities.optimize && Vue.prototype.$isServer ? config.entities.productList.excludeFields : null,
      append: false
    }
  },
  asyncData ({ store, route }) { // this is for SSR purposes to prefetch data
    return new Promise((resolve, reject) => {
      console.log('Entering asyncData for Category root ' + new Date())
      const defaultFilters = config.products.defaultFilters
      store.dispatch('category/list', { includeFields: config.entities.optimize && Vue.prototype.$isServer ? config.entities.category.includeFields : null }).then((categories) => {
        store.dispatch('attribute/list', { // load filter attributes for this specific category
          filterValues: defaultFilters, // TODO: assign specific filters/ attribute codes dynamicaly to specific categories
          includeFields: config.entities.optimize && Vue.prototype.$isServer ? config.entities.attribute.includeFields : null
        }).catch(err => {
          console.error(err)
          reject(err)
        }).then((attrs) => {
          store.dispatch('category/single', { key: 'slug', value: route.params.slug }).then((parentCategory) => {
            let query = store.state.category.current_product_query
            if (!query.searchProductQuery) {
              query = Object.assign(query, { searchProductQuery: baseFilterProductsQuery(parentCategory, defaultFilters) })
            }
            store.dispatch('category/products', query).then((subloaders) => {
              Promise.all(subloaders).then((results) => {
                EventBus.$emitFilter('category-after-load', { store: store, route: route }).then((results) => {
                  return resolve()
                }).catch((err) => {
                  console.error(err)
                  return resolve()
                })
              }).catch(err => {
                console.error(err)
                reject(err)
              })
            }).catch(err => {
              console.error(err)
              reject(err)
            })
          }).catch(err => {
            console.error(err)
            reject(err)
          })
        })
      }).catch(err => {
        console.error(err)
        reject(err)
      })
    })
  },
  created () {
    this.$bus.$on('filter-changed-category', this.onFilterChanged)
    this.$bus.$on('list-change-sort', (param) => { this.onSortOrderChanged(param) })
    if (config.usePriceTiers) {
      this.$bus.$on('user-after-loggedin', this.onUserPricesRefreshed)
      this.$bus.$on('user-after-logout', this.onUserPricesRefreshed)
    }
    if (!Vue.prototype.$isServer && this.lazyLoadProductsOnscroll) {
      window.addEventListener('scroll', () => {
        this.bottom = this.bottomVisible()
      })
    }
  },
  beforeDestroy () {
    this.$bus.$off('filter-changed-category', this.onFilterChanged)
    if (config.usePriceTiers) {
      this.$bus.$off('user-after-loggedin', this.onUserPricesRefreshed)
      this.$bus.$off('user-after-logout', this.onUserPricesRefreshed)
    }
  },
  methods: {
    bottomVisible () {
      const scrollY = window.scrollY
      const visible = document.documentElement.clientHeight
      const pageHeight = document.documentElement.scrollHeight
      const bottomOfPage = visible + scrollY >= pageHeight
      return bottomOfPage || pageHeight < visible
    },
    pullMoreProducts () {
      let currentQuery = this.currentQuery
      currentQuery.append = true
      currentQuery.route = this.$route
      currentQuery.store = this.$store
      currentQuery.current = currentQuery.current + currentQuery.perPage
      this.pagination.current = currentQuery.current
      this.pagination.perPage = currentQuery.perPage
      if (currentQuery.current <= this.productsTotal) {
        currentQuery.searchProductQuery = buildFilterProductsQuery(this.category, this.filters.chosen)
        return this.$store.dispatch('category/products', currentQuery)
      }
    },
    onFilterChanged (filterOption) {
      this.pagination.current = 0
      if (this.filters.chosen[filterOption.attribute_code] && ((toString(filterOption.id) === toString(this.filters.chosen[filterOption.attribute_code].id)) || filterOption.id === this.filters.chosen[filterOption.attribute_code].id)) { // for price filter it's a string
        delete this.filters.chosen[filterOption.attribute_code]
      } else {
        this.filters.chosen[filterOption.attribute_code] = filterOption
      }

      let filterQr = buildFilterProductsQuery(this.category, this.filters.chosen)

      const fsC = Object.assign({}, this.filters.chosen) // create a copy because it will be used asynchronously (take a look below)
      this.$store.state.category.current_product_query = Object.assign(this.$store.state.category.current_product_query, {
        populateAggregations: false,
        searchProductQuery: filterQr,
        current: this.pagination.current,
        perPage: this.pagination.perPage,
        configuration: fsC,
        append: false,
        includeFields: null,
        excludeFields: null
      })
      this.$store.dispatch('category/products', this.$store.state.category.current_product_query).then((res) => {
      }) // because already aggregated
    },
    onSortOrderChanged (param) {
      if (param.attribute) {
        let filterQr = buildFilterProductsQuery(this.category, this.filters.chosen)
        this.$store.state.category.current_product_query = Object.assign(this.$store.state.category.current_product_query, {
          sort: param.attribute + ':' + param.direction,
          searchProductQuery: filterQr,
          append: false
        })
        this.$store.dispatch('category/products', this.$store.state.category.current_product_query).then((res) => {
        })
      } else {
        this.$bus.$emit('notification', {
          type: 'error',
          message: i18n.t('Please select the field which You like to sort by'),
          action1: { label: i18n.t('OK'), action: 'close' }
        })
      }
    },
    validateRoute () {
      this.filters.chosen = {} // reset selected filters
      this.$bus.$emit('filter-reset')

      this.$store.dispatch('category/single', { key: 'slug', value: this.$route.params.slug }).then(category => {
        if (!category) {
          this.$router.push('/')
        } else {
          this.pagination.current = 0
          let searchProductQuery = baseFilterProductsQuery(this.$store.state.category.current, config.products.defaultFilters)
          this.$bus.$emit('current-category-changed', this.$store.state.category.current_path)
          let query = this.$store.state.category.current_product_query
          query = Object.assign(query, { // base prototype from the asyncData is being used here
            current: this.pagination.current,
            perPage: this.pagination.perPage,
            store: this.$store,
            route: this.$route,
            append: false,
            populateAggregations: true
          })
          if (!query.searchProductQuery) {
            query.searchProductQuery = searchProductQuery
          }
          this.$store.dispatch('category/products', this.$store.state.category.current_product_query)
          EventBus.$emitFilter('category-after-load', { store: this.$store, route: this.$route })
        }
      })
    },
    onUserPricesRefreshed () {
      const defaultFilters = config.products.defaultFilters
      this.$store.dispatch('category/single', {
        key: 'slug',
        value: this.$route.params.slug
      }).then((parentCategory) => {
        let query = this.$store.state.category.current_product_query
        if (!query.searchProductQuery) {
          query = Object.assign(query, {
            searchProductQuery: baseFilterProductsQuery(parentCategory, defaultFilters),
            skipCache: true
          })
        }
        this.$store.dispatch('category/products', query)
      })
    }
  },
  metaInfo () {
    return {
      title: htmlDecode(this.$route.meta.title || this.categoryName),
      meta: this.$route.meta.description ? [{ vmid: 'description', description: htmlDecode(this.$route.meta.description) }] : []
    }
  }
}
