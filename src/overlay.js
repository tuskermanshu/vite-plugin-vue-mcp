import { devtools, devtoolsRouter, devtoolsRouterInfo, devtoolsState, getInspector, stringify, toggleHighPerfMode } from '@vue/devtools-kit'

import { createRPCClient } from 'vite-dev-rpc'
import { createHotContext } from 'vite-hot-client'

const base = import.meta.env.BASE_URL || '/'
const hot = createHotContext('', base)
const PINIA_INSPECTOR_ID = 'pinia'
const COMPONENTS_INSPECTOR_ID = 'components'

devtools.init()

let highlightComponentTimeout = null

function flattenChildren(node) {
  const result = []

  function traverse(node) {
    if (!node)
      return
    result.push(node)

    if (Array.isArray(node.children)) {
      node.children.forEach(child => traverse(child))
    }
  }

  traverse(node)
  return result
}

const rpc = createRPCClient(
  'vite-plugin-vue-mcp',
  hot,
  {
    // get component tree
    async getInspectorTree(query) {
      const inspectorTree = await devtools.api.getInspectorTree({
        inspectorId: COMPONENTS_INSPECTOR_ID,
        filter: '',
      })
      rpc.onInspectorTreeUpdated(query.event, inspectorTree[0])
    },
    // get component state
    async getInspectorState(query) {
      const inspectorTree = await devtools.api.getInspectorTree({
        inspectorId: COMPONENTS_INSPECTOR_ID,
        filter: '',
      })
      const flattenedChildren = flattenChildren(inspectorTree[0])
      const targetNode = flattenedChildren.find(child => child.name === query.componentName)
      const inspectorState = await devtools.api.getInspectorState({
        inspectorId: COMPONENTS_INSPECTOR_ID,
        nodeId: targetNode.id,
      })
      rpc.onInspectorStateUpdated(query.event, stringify(inspectorState))
    },

    // edit component state
    async editComponentState(query) {
      const inspectorTree = await devtools.api.getInspectorTree({
        inspectorId: COMPONENTS_INSPECTOR_ID,
        filter: '',
      })
      const flattenedChildren = flattenChildren(inspectorTree[0])
      const targetNode = flattenedChildren.find(child => child.name === query.componentName)
      const payload = {
        inspectorId: COMPONENTS_INSPECTOR_ID,
        nodeId: targetNode.id,
        path: query.path,
        state: {
          new: null,
          remove: false,
          type: query.valueType,
          value: query.value,
        },
        type: undefined,
      }
      await devtools.ctx.api.editInspectorState(payload)
    },

    // highlight component
    async highlightComponent(query) {
      clearTimeout(highlightComponentTimeout)
      const inspectorTree = await devtools.api.getInspectorTree({
        inspectorId: COMPONENTS_INSPECTOR_ID,
        filter: '',
      })
      const flattenedChildren = flattenChildren(inspectorTree[0])
      const targetNode = flattenedChildren.find(child => child.name === query.componentName)
      devtools.ctx.hooks.callHook('componentHighlight', { uid: targetNode.id })
      highlightComponentTimeout = setTimeout(() => {
        devtools.ctx.hooks.callHook('componentUnhighlight')
      }, 5000)
    },
    // get router info
    async getRouterInfo(query) {
      rpc.onRouterInfoUpdated(query.event, JSON.stringify(devtoolsRouterInfo, null, 2))
    },

    async navigateRouter(query) {
      // 检查路由器实例是否可用
      if (!devtoolsRouter.value) {
        console.warn('Router instance not available')
        return
      }

      // 构建路由位置对象
      const routeLocation = {
        path: query.path || '/',
      }

      // 添加可选参数
      if (query.query)
        routeLocation.query = query.query
      if (query.hash)
        routeLocation.hash = query.hash
      if (query.params)
        routeLocation.params = query.params

      try {
        // 根据replace参数决定导航方式
        const navigationMethod = query.replace ? 'replace' : 'push'

        // 添加导航选项对象，处理force参数
        const navigationOptions = {}
        if (query.force === true) {
          navigationOptions.force = true
        }

        // 执行导航并等待完成
        await devtoolsRouter.value[navigationMethod](routeLocation, navigationOptions)

        // 通知devtools路由已更新
        devtools.ctx.hooks.callHook('routerInfoUpdated', {
          state: devtoolsRouterInfo,
        })

        // 如果有事件回调，返回更新后的路由信息
        if (query.event) {
          rpc.onRouterInfoUpdated(query.event, JSON.stringify(devtoolsRouterInfo, null, 2))
        }
      }
      catch (err) {
        console.warn('Navigation failed:', err)

        // 如果有事件回调，返回错误信息
        if (query.event) {
          rpc.onRouterInfoUpdated(query.event, JSON.stringify({ error: err.message }))
        }
      }
    },
    // get pinia tree
    async getPiniaTree(query) {
      const highPerfModeEnabled = devtoolsState.highPerfModeEnabled
      if (highPerfModeEnabled) {
        toggleHighPerfMode(false)
      }
      const inspectorTree = await devtools.api.getInspectorTree({
        inspectorId: PINIA_INSPECTOR_ID,
        filter: '',
      })
      if (highPerfModeEnabled) {
        toggleHighPerfMode(true)
      }
      rpc.onPiniaTreeUpdated(query.event, inspectorTree)
    },
    // get pinia state
    async getPiniaState(query) {
      const highPerfModeEnabled = devtoolsState.highPerfModeEnabled
      if (highPerfModeEnabled) {
        toggleHighPerfMode(false)
      }
      const payload = {
        inspectorId: PINIA_INSPECTOR_ID,
        nodeId: query.storeName,
      }
      const inspector = getInspector(payload.inspectorId)

      if (inspector)
        inspector.selectedNodeId = payload.nodeId

      const res = await devtools.ctx.api.getInspectorState(payload)
      if (highPerfModeEnabled) {
        toggleHighPerfMode(true)
      }
      rpc.onPiniaInfoUpdated(query.event, stringify(res))
    },
  },
  {
    timeout: -1,
  },
)
