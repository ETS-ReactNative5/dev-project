/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ReactFiberCompleteWork
 * @flow
 */

'use strict';

import type { ReactCoroutine } from 'ReactCoroutine';
import type { Fiber } from 'ReactFiber';
import type { FiberRoot } from 'ReactFiberRoot';
import type { HostConfig } from 'ReactFiberReconciler';
import type { ReifiedYield } from 'ReactReifiedYield';

var { reconcileChildFibers } = require('ReactChildFiber');
var {
  isContextProvider,
  popContextProvider,
} = require('ReactFiberContext');
var ReactTypeOfWork = require('ReactTypeOfWork');
var ReactTypeOfSideEffect = require('ReactTypeOfSideEffect');
var {
  IndeterminateComponent,
  FunctionalComponent,
  ClassComponent,
  HostContainer,
  HostComponent,
  HostText,
  CoroutineComponent,
  CoroutineHandlerPhase,
  YieldComponent,
  Fragment,
  Portal,
} = ReactTypeOfWork;
var {
  Update,
  Callback,
} = ReactTypeOfSideEffect;

module.exports = function<T, P, I, TI, C>(config : HostConfig<T, P, I, TI, C>) {

  const createInstance = config.createInstance;
  const appendInitialChild = config.appendInitialChild;
  const finalizeInitialChildren = config.finalizeInitialChildren;
  const createTextInstance = config.createTextInstance;
  const prepareUpdate = config.prepareUpdate;

  function markUpdate(workInProgress : Fiber) {
    // Tag the fiber with an update effect. This turns a Placement into
    // an UpdateAndPlacement.
    workInProgress.effectTag |= Update;
  }

  function markCallback(workInProgress : Fiber) {
    // Tag the fiber with a callback effect.
    workInProgress.effectTag |= Callback;
  }

  function transferOutput(child : ?Fiber, returnFiber : Fiber) {
    // If we have a single result, we just pass that through as the output to
    // avoid unnecessary traversal. When we have multiple output, we just pass
    // the linked list of fibers that has the individual output values.
    returnFiber.output = (child && !child.sibling) ? child.output : child;
    returnFiber.memoizedProps = returnFiber.pendingProps;
  }

  function recursivelyFillYields(yields, output : ?Fiber | ?ReifiedYield) {
    if (!output) {
      // Ignore nulls etc.
    } else if (output.tag !== undefined) { // TODO: Fix this fragile duck test.
      // Detect if this is a fiber, if so it is a fragment result.
      // $FlowFixMe: Refinement issue.
      var item = (output : Fiber);
      do {
        recursivelyFillYields(yields, item.output);
        item = item.sibling;
      } while (item);
    } else {
      // $FlowFixMe: Refinement issue. If it is not a Fiber or null, it is a yield
      yields.push(output);
    }
  }

  function moveCoroutineToHandlerPhase(current : ?Fiber, workInProgress : Fiber) {
    var coroutine = (workInProgress.pendingProps : ?ReactCoroutine);
    if (!coroutine) {
      throw new Error('Should be resolved by now');
    }

    // First step of the coroutine has completed. Now we need to do the second.
    // TODO: It would be nice to have a multi stage coroutine represented by a
    // single component, or at least tail call optimize nested ones. Currently
    // that requires additional fields that we don't want to add to the fiber.
    // So this requires nested handlers.
    // Note: This doesn't mutate the alternate node. I don't think it needs to
    // since this stage is reset for every pass.
    workInProgress.tag = CoroutineHandlerPhase;

    // Build up the yields.
    // TODO: Compare this to a generator or opaque helpers like Children.
    var yields : Array<ReifiedYield> = [];
    var child = workInProgress.child;
    while (child) {
      recursivelyFillYields(yields, child.output);
      child = child.sibling;
    }
    var fn = coroutine.handler;
    var props = coroutine.props;
    var nextChildren = fn(props, yields);

    var currentFirstChild = current ? current.stateNode : null;
    // Inherit the priority of the returnFiber.
    const priority = workInProgress.pendingWorkPriority;
    workInProgress.stateNode = reconcileChildFibers(
      workInProgress,
      currentFirstChild,
      nextChildren,
      priority
    );
    return workInProgress.stateNode;
  }

  function appendAllChildren(parent : I, workInProgress : Fiber) {
    // We only have the top Fiber that was created but we need recurse down its
    // children to find all the terminal nodes.
    let node = workInProgress.child;
    while (node) {
      if (node.tag === HostComponent || node.tag === HostText) {
        appendInitialChild(parent, node.stateNode);
      } else if (node.tag === Portal) {
        // If we have a portal child, then we don't want to traverse
        // down its children. Instead, we'll get insertions from each child in
        // the portal directly.
      } else if (node.child) {
        // TODO: Coroutines need to visit the stateNode.
        node = node.child;
        continue;
      }
      if (node === workInProgress) {
        return;
      }
      while (!node.sibling) {
        if (!node.return || node.return === workInProgress) {
          return;
        }
        node = node.return;
      }
      node = node.sibling;
    }
  }

  function completeWork(current : ?Fiber, workInProgress : Fiber) : ?Fiber {
    switch (workInProgress.tag) {
      case FunctionalComponent:
        transferOutput(workInProgress.child, workInProgress);
        return null;
      case ClassComponent:
        transferOutput(workInProgress.child, workInProgress);
        // We are leaving this subtree, so pop context if any.
        if (isContextProvider(workInProgress)) {
          popContextProvider();
        }
        // Don't use the state queue to compute the memoized state. We already
        // merged it and assigned it to the instance. Transfer it from there.
        // Also need to transfer the props, because pendingProps will be null
        // in the case of an update
        const { state, props } = workInProgress.stateNode;
        const updateQueue = workInProgress.updateQueue;
        workInProgress.memoizedState = state;
        workInProgress.memoizedProps = props;
        if (current) {
          if (current.memoizedProps !== workInProgress.memoizedProps ||
              current.memoizedState !== workInProgress.memoizedState ||
              updateQueue && updateQueue.isForced) {
            markUpdate(workInProgress);
          }
        } else {
          markUpdate(workInProgress);
        }
        if (updateQueue && updateQueue.hasCallback) {
          // Transfer update queue to callbackList field so callbacks can be
          // called during commit phase.
          workInProgress.callbackList = updateQueue;
          markCallback(workInProgress);
        }
        return null;
      case HostContainer: {
        transferOutput(workInProgress.child, workInProgress);
        popContextProvider();
        const fiberRoot = (workInProgress.stateNode : FiberRoot);
        if (fiberRoot.pendingContext) {
          fiberRoot.context = fiberRoot.pendingContext;
          fiberRoot.pendingContext = null;
        }
        // TODO: Only mark this as an update if we have any pending callbacks
        // on it.
        markUpdate(workInProgress);
        return null;
      }
      case HostComponent:
        let newProps = workInProgress.pendingProps;
        if (current && workInProgress.stateNode != null) {
          // If we have an alternate, that means this is an update and we need to
          // schedule a side-effect to do the updates.
          const oldProps = current.memoizedProps;
          // If we get updated because one of our children updated, we don't
          // have newProps so we'll have to reuse them.
          // TODO: Split the update API as separate for the props vs. children.
          // Even better would be if children weren't special cased at all tho.
          if (!newProps) {
            newProps = workInProgress.memoizedProps || oldProps;
          }
          const instance : I = workInProgress.stateNode;
          if (prepareUpdate(instance, oldProps, newProps)) {
            // This returns true if there was something to update.
            markUpdate(workInProgress);
          }
          // TODO: Is this actually ever going to change? Why set it every time?
          workInProgress.output = instance;
        } else {
          if (!newProps) {
            if (workInProgress.stateNode === null) {
              throw new Error('We must have new props for new mounts.');
            } else {
              // This can happen when we abort work.
              return null;
            }
          }

          // TODO: Move createInstance to beginWork and keep it on a context
          // "stack" as the parent. Then append children as we go in beginWork
          // or completeWork depending on we want to add then top->down or
          // bottom->up. Top->down is faster in IE11.
          // Finally, finalizeInitialChildren here in completeWork.
          const instance = createInstance(workInProgress.type, newProps, workInProgress);
          appendAllChildren(instance, workInProgress);
          finalizeInitialChildren(instance, workInProgress.type, newProps);

          // TODO: This seems like unnecessary duplication.
          workInProgress.stateNode = instance;
          workInProgress.output = instance;
          if (workInProgress.ref) {
            // If there is a ref on a host node we need to schedule a callback
            markUpdate(workInProgress);
          }
        }
        workInProgress.memoizedProps = newProps;
        return null;
      case HostText:
        let newText = workInProgress.pendingProps;
        if (current && workInProgress.stateNode != null) {
          // If we have an alternate, that means this is an update and we need to
          // schedule a side-effect to do the updates.
          markUpdate(workInProgress);
        } else {
          if (typeof newText !== 'string') {
            if (workInProgress.stateNode === null) {
              throw new Error('We must have new props for new mounts.');
            } else {
              // This can happen when we abort work.
              return null;
            }
          }
          const textInstance = createTextInstance(newText, workInProgress);
          // TODO: This seems like unnecessary duplication.
          workInProgress.stateNode = textInstance;
          workInProgress.output = textInstance;
        }
        workInProgress.memoizedProps = newText;
        return null;
      case CoroutineComponent:
        return moveCoroutineToHandlerPhase(current, workInProgress);
      case CoroutineHandlerPhase:
        transferOutput(workInProgress.stateNode, workInProgress);
        // Reset the tag to now be a first phase coroutine.
        workInProgress.tag = CoroutineComponent;
        return null;
      case YieldComponent:
        // Does nothing.
        return null;
      case Fragment:
        transferOutput(workInProgress.child, workInProgress);
        return null;
      case Portal:
        // TODO: Only mark this as an update if we have any pending callbacks.
        markUpdate(workInProgress);
        workInProgress.output = null;
        workInProgress.memoizedProps = workInProgress.pendingProps;
        return null;

      // Error cases
      case IndeterminateComponent:
        throw new Error('An indeterminate component should have become determinate before completing.');
      default:
        throw new Error('Unknown unit of work tag');
    }
  }

  return {
    completeWork,
  };

};
