import {
    getContext,
    getInstances,
    getComponentName,
    recyclableNodes,
    midway,
    extend
} from './util'
import {applyComponentHook} from './lifecycle'

import {transaction} from './transaction'
import {toVnode} from './toVnode'
import {diffProps} from './diffProps'
import {document, createDOMElement} from './browser'
import {removeRef} from './ref'
import {setControlledComponent} from './ControlledComponent'

// createElement创建的虚拟DOM叫baseVnode,用于确定DOM树的结构与保存原始数据与DOM节点
// 如果baseVnode的type类型为函数，那么产生实例

/**
 * 渲染组件
 *
 * @param {any} instance
 */
export function updateComponent(instance) {
    var {props, state, context, prevProps} = instance
    var oldRendered = instance._rendered
    var baseVnode = instance.getBaseVnode()
    var hostParent = baseVnode._hostParent || oldRendered._hostParent

    var nextProps = props
    prevProps = prevProps || props
    var nextState = instance._processPendingState(props, context)

    instance.props = prevProps
    delete instance.prevProps
    //生命周期 shouldComponentUpdate(nextProps, nextState, nextContext)
    if (!instance._forceUpdate && applyComponentHook(instance, 4, nextProps, nextState, context) === false) {
        return baseVnode._hostNode //注意
    }
    //生命周期 componentWillUpdate(nextProps, nextState, nextContext)
    applyComponentHook(instance, 5, nextProps, nextState, context)
    instance.props = nextProps
    instance.state = nextState
    delete instance._updateBatchNumber

    var rendered = transaction.renderWithoutSetState(instance, nextProps, context)
    context = getContext(instance, context)
    instance._rendered = rendered
    // rendered的type为函数时，会多次进入toVnode  var dom = diff(rendered, oldRendered,
    // hostParent, context, baseVnode._hostNode)
    var dom = diffChildren([rendered], [oldRendered], hostParent, context)
    baseVnode._hostNode = dom
    //生命周期 componentDidUpdate(prevProps, prevState, prevContext)
    applyComponentHook(instance, 6, nextProps, nextState, context)

    return dom //注意
}
/**
 * call componentWillUnmount
 *
 * @param {any} vnode
 */
function removeComponent(vnode) {
    if (vnode._hostNode && vnode.type === '#text' && recyclableNodes.length < 512) {
        recyclableNodes.push(vnode._hostNode)
    }
    var instance = vnode._instance

    instance && applyComponentHook(instance, 7) //componentWillUnmount hook

    '_hostNode,_hostParent,_instance,_wrapperState,_owner'.replace(/\w+/g, function (name) {
        vnode[name] = NaN
    })
    var props = vnode.props
    if (props) {
        removeRef(instance, props.ref)
        props
            .children
            .forEach(function (el) {
                removeComponent(el)
            })
    }

}

function removeComponents(nodes) {
    for (var i = 0, el; el = nodes[i++];) {
        var dom = el._hostNode
        if (!dom && el._instance) {
            var a = el
                ._instance
                .getBaseVnode()
            dom = a && a._hostNode
        }

        if (dom && dom.parentNode) {
            dom
                .parentNode
                .removeChild(dom)
        }
        removeComponent(el)
    }
}

/**
 * 参数不要出现DOM,以便在后端也能运行
 *
 * @param {VNode} vnode 新的虚拟DOM
 * @param {VNode} prevVnode 旧的虚拟DOM
 * @param {VNode} hostParent 父虚拟DOM
 * @param {Object} context
 * @param {DOM} prevNode
 * @returns
 */
export function diff(vnode, prevVnode, hostParent, context, prevNode, prevInstance) { //updateComponent

    var baseVnode = vnode
    var hostNode = prevVnode._hostNode

    prevInstance = prevInstance || prevVnode._instance

    var prevProps = prevVnode.props || {}
    if (prevInstance) {
        var instance = prevInstance
        vnode._instance = prevInstance
        baseVnode = prevInstance.getBaseVnode()
        hostNode = baseVnode._hostNode

        vnode._instance = instance

        instance.context = context //更新context
        instance.prevProps = prevProps
        var nextProps = vnode.props
        //处理非状态组件
        if (instance.statelessRender) {
            instance.props = nextProps
            return updateComponent(instance, context)
        }
        //componentWillReceiveProps(nextProps, nextContext)
        applyComponentHook(instance, 3, nextProps, context)

        instance.props = nextProps

        return updateComponent(instance, context)
    }

    if (typeof vnode.type === 'function') {
        var parentInstance = prevInstance && prevInstance.parentInstance

        return toDOM(vnode, context, hostParent, prevNode, parentInstance)

    }
    var parentNode = hostParent._hostNode
    var prevChildren = prevProps.children || []
    if (!hostNode) {
        //如果元素类型不一致
        var nextNode = createDOMElement(vnode)
        parentNode.insertBefore(nextNode, hostNode || null)
        prevChildren = []
        prevProps = {}
        if (prevNode) {
            parentNode.removeChild(prevNode)
        }
        removeComponent(prevVnode)
        hostNode = nextNode
    }

    //必须在diffProps前添加它的真实节点

    baseVnode._hostNode = hostNode
    baseVnode._hostParent = hostParent

    if (prevProps.dangerouslySetInnerHTML) {
        while (hostNode.firstChild) {
            hostNode.removeChild(hostNode.firstChild)
        }
    }
    var props = vnode.props
    if (props) {
        if (!props.angerouslySetInnerHTML) {
            var currChildren = props.children
            var n1 = currChildren.length
            var n2 = prevChildren.length
            var old = prevChildren[0]
            var neo = currChildren[0]
            if (!neo && old) {
                removeComponents(prevChildren)

            } else if (neo && !old) {
                var beforeDOM = null
                for (var i = 0, el; el = currChildren[i++];) {
                    var dom = el._hostNode = toDOM(el, context, baseVnode, beforeDOM)
                    beforeDOM = dom.nextSibling
                }

        //    } else if (n1 + n2 === 2 && neo.type === old.type) {

       //         neo._hostNode = diff(neo, old, baseVnode, context, old._hostNode, old._instance)

            } else {
                diffChildren(currChildren, prevChildren, baseVnode, context)
            }
        }
        diffProps(props, prevProps, vnode, prevVnode)
    }

    var wrapperState = vnode._wrapperState
    if (wrapperState && wrapperState.postUpdate) { //处理select
        wrapperState.postUpdate(vnode)
    }
    return hostNode
}

/**
 *
 *
 * @param {any} type
 * @param {any} vnode
 * @returns
 */
function computeUUID(type, vnode) {
    if (type === '#text') {
        return type + '/' + vnode.deep
    }

    return type + '/' + vnode.deep + (vnode.key
        ? '/' + vnode.key
        : '')
}

/**
 *
 *
 * @param {any} newChildren
 * @param {any} oldChildren
 * @param {any} hostParent
 * @param {any} context
 */
function diffChildren(newChildren, oldChildren, hostParent, context) {
    //第一步，根据实例的类型，nodeName, nodeValue, key与数组深度 构建hash
    var mapping = {},
        debugString = '',
        returnDOM,
        hashmap = {},
        parentNode = hostParent._hostNode,
        branch;

    for (let i = 0, n = oldChildren.length; i < n; i++) {
        let vnode = oldChildren[i]

        vnode.uuid = '.' + i
        hashmap[vnode.uuid] = vnode
        let uuid = computeUUID(getComponentName(vnode.type), vnode)
        debugString += uuid + ' '
        if (mapping[uuid]) {
            mapping[uuid].push(vnode)
        } else {
            mapping[uuid] = [vnode]
        }
    }

    //console.log('旧的',debugString) 第2步，遍历新children, 从hash中取出旧节点, 然后一一比较
    debugString = ''
    var firstDOM = oldChildren[0] && oldChildren[0]._hostNode
    var insertPoint = firstDOM
    for (let i = 0, n = newChildren.length; i < n; i++) {
        let vnode = newChildren[i];
        let tag = getComponentName(vnode.type)

        let uuid = computeUUID(tag, vnode)
        debugString += uuid + ' '
        var prevVnode = null
        if (mapping[uuid]) {
            prevVnode = mapping[uuid].shift()

            if (!mapping[uuid].length) {
                delete mapping[uuid]
            }
            delete hashmap[prevVnode.uuid]
        }

        vnode._hostParent = hostParent

        if (prevVnode) { //它们的组件类型， 或者标签类型相同
            var prevInstance = prevVnode._instance

            if ('text' in vnode) {
                var textNode = vnode._hostNode = prevVnode._hostNode
                if (vnode.text !== prevVnode.text) {
                    textNode.nodeValue = vnode.text
                }
                branch = 'B'
                if (textNode !== insertPoint) {
                    parentNode.insertBefore(textNode, insertPoint)
                }
            } else {
                vnode._hostNode = diff(vnode, prevVnode, hostParent, context, insertPoint, prevInstance)
                branch = 'C'
            }

        } else { //添加新节点

            vnode._hostNode = toDOM(vnode, context, hostParent, insertPoint, null)
            branch = 'D'

        }
        if (i === 0) {
            returnDOM = vnode._hostNode
            if (branch != 'D' && firstDOM && vnode._hostNode !== firstDOM) {
               // console.log('调整位置。。。。')
                parentNode.replaceChild(vnode._hostNode, firstDOM)
            }
        }

        insertPoint = vnode._hostNode.nextSibling

    }
    //console.log('新的',debugString) 第3步，移除无用节点
    var removedChildren = []
    for (var key in hashmap) {
        removedChildren.push(hashmap[key])

    }
    if (removedChildren.length) {
        removeComponents(removedChildren)
    }
    return returnDOM

}

/**
 *
 * @export
 * @param {VNode} vnode
 * @param {DOM} context
 * @param {DOM} parentNode ?
 * @param {DOM} replaced ?
 * @returns
 */
export function toDOM(vnode, context, hostParent, prevNode, parentIntance) {
    //如果一个虚拟DOM的type为字符串 或 它拥有instance，且这个instance不再存在parentInstance, 那么它就可以拥有_dom属性
    vnode = toVnode(vnode, context, parentIntance)
    if (vnode.context) {
        context = vnode.context
        if (vnode.refs) 
            delete vnode.context
    }
    var hostNode = createDOMElement(vnode)
    var props = vnode.props
    var parentNode = hostParent._hostNode
    var instance = vnode._instance || vnode._owner
    var canComponentDidMount = instance && !vnode._hostNode
    //每个实例保存其虚拟DOM 最开始的虚拟DOM保存instance

    if (typeof vnode.type === 'string') {
        vnode._hostNode = hostNode
        vnode._hostParent = hostParent
    }
    if (instance) {
        var baseVnode = instance.getBaseVnode()
        if (!baseVnode._hostNode) {
            baseVnode._hostNode = hostNode
            baseVnode._hostParent = hostParent
        }
    }

    //文本是没有instance, 只有empty与元素节点有instance

    if (parentNode) {
        parentNode.insertBefore(hostNode, prevNode || null)
    }
    //只有元素与组件才有props
    if (props && !props.dangerouslySetInnerHTML) {
        // 先diff Children 再 diff Props 最后是 diff ref
        diffChildren(props.children, [], vnode, context) //添加第4参数
    }
    //尝试插入DOM树
    if (parentNode) {
        var instances
        if (canComponentDidMount) { //判定能否调用componentDidMount方法
            instances = getInstances(instance)
        }
        if (props) {

            diffProps(props, {}, vnode, {})
            setControlledComponent(vnode)
        }
        if (instances) {

            while (instance = instances.shift()) {
                applyComponentHook(instance, 2)
            }
        }
    }

    return hostNode
}
//将Component中这个东西移动这里
midway.immune.updateComponent = function updateComponentProxy(instance) { //这里触发视图更新

    updateComponent(instance)
    instance._forceUpdate = false
}