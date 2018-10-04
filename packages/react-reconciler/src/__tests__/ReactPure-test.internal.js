/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 * @jest-environment node
 */

/* eslint-disable no-func-assign */

'use strict';

let React;
let ReactFeatureFlags;
let ReactNoop;

describe('pure', () => {
  beforeEach(() => {
    jest.resetModules();
    ReactFeatureFlags = require('shared/ReactFeatureFlags');
    ReactFeatureFlags.debugRenderPhaseSideEffectsForStrictMode = false;
    ReactFeatureFlags.enableSuspense = true;
    React = require('react');
    ReactNoop = require('react-noop-renderer');
  });

  function span(prop) {
    return {type: 'span', children: [], prop};
  }

  function Text(props) {
    ReactNoop.yield(props.text);
    return <span prop={props.text} />;
  }

  // Tests should run against both the lazy and non-lazy versions of `pure`.
  // To make the tests work for both versions, we wrap the non-lazy verion in
  // a lazy function component.
  sharedTests('normal', (...args) => {
    const Pure = React.pure(...args);
    function Indirection(props) {
      return <Pure {...props} />;
    }
    return Promise.resolve(Indirection);
  });
  sharedTests('lazy', (...args) => Promise.resolve(React.pure(...args)));

  function sharedTests(label, pure) {
    describe(`${label}`, () => {
      it('bails out on props equality', async () => {
        const {Placeholder} = React;

        function Counter({count}) {
          return <Text text={count} />;
        }
        Counter = pure(Counter);

        ReactNoop.render(
          <Placeholder>
            <Counter count={0} />
          </Placeholder>,
        );
        expect(ReactNoop.flush()).toEqual([]);
        await Promise.resolve();
        expect(ReactNoop.flush()).toEqual([0]);
        expect(ReactNoop.getChildren()).toEqual([span(0)]);

        // Should bail out because props have not changed
        ReactNoop.render(
          <Placeholder>
            <Counter count={0} />
          </Placeholder>,
        );
        expect(ReactNoop.flush()).toEqual([]);
        expect(ReactNoop.getChildren()).toEqual([span(0)]);

        // Should update because count prop changed
        ReactNoop.render(
          <Placeholder>
            <Counter count={1} />
          </Placeholder>,
        );
        expect(ReactNoop.flush()).toEqual([1]);
        expect(ReactNoop.getChildren()).toEqual([span(1)]);
      });
    });

    it("does not bail out if there's a context change", async () => {
      const {Placeholder} = React;

      const CountContext = React.createContext(0);

      function Counter(props) {
        const count = CountContext.unstable_read();
        return <Text text={`${props.label}: ${count}`} />;
      }
      Counter = pure(Counter);

      class Parent extends React.Component {
        state = {count: 0};
        render() {
          return (
            <Placeholder>
              <CountContext.Provider value={this.state.count}>
                <Counter label="Count" />
              </CountContext.Provider>
            </Placeholder>
          );
        }
      }

      const parent = React.createRef(null);
      ReactNoop.render(<Parent ref={parent} />);
      expect(ReactNoop.flush()).toEqual([]);
      await Promise.resolve();
      expect(ReactNoop.flush()).toEqual(['Count: 0']);
      expect(ReactNoop.getChildren()).toEqual([span('Count: 0')]);

      // Should bail out because props have not changed
      ReactNoop.render(<Parent ref={parent} />);
      expect(ReactNoop.flush()).toEqual([]);
      expect(ReactNoop.getChildren()).toEqual([span('Count: 0')]);

      // Should update because there was a context change
      parent.current.setState({count: 1});
      expect(ReactNoop.flush()).toEqual(['Count: 1']);
      expect(ReactNoop.getChildren()).toEqual([span('Count: 1')]);
    });

    it('accepts custom comparison function', async () => {
      const {Placeholder} = React;

      function Counter({count}) {
        return <Text text={count} />;
      }
      Counter = pure(Counter, (oldProps, newProps) => {
        ReactNoop.yield(
          `Old count: ${oldProps.count}, New count: ${newProps.count}`,
        );
        return oldProps.count === newProps.count;
      });

      ReactNoop.render(
        <Placeholder>
          <Counter count={0} />
        </Placeholder>,
      );
      expect(ReactNoop.flush()).toEqual([]);
      await Promise.resolve();
      expect(ReactNoop.flush()).toEqual([0]);
      expect(ReactNoop.getChildren()).toEqual([span(0)]);

      // Should bail out because props have not changed
      ReactNoop.render(
        <Placeholder>
          <Counter count={0} />
        </Placeholder>,
      );
      expect(ReactNoop.flush()).toEqual(['Old count: 0, New count: 0']);
      expect(ReactNoop.getChildren()).toEqual([span(0)]);

      // Should update because count prop changed
      ReactNoop.render(
        <Placeholder>
          <Counter count={1} />
        </Placeholder>,
      );
      expect(ReactNoop.flush()).toEqual(['Old count: 0, New count: 1', 1]);
      expect(ReactNoop.getChildren()).toEqual([span(1)]);
    });

    it('warns for class components', () => {
      class SomeClass extends React.Component {
        render() {
          return null;
        }
      }
      expect(() => pure(SomeClass)).toWarnDev(
        'pure: The first argument must be a function component.',
        {withoutStack: true},
      );
    });

    it('warns if first argument is not a function', () => {
      expect(() => pure()).toWarnDev(
        'pure: The first argument must be a function component. Instead ' +
          'received: undefined',
        {withoutStack: true},
      );
    });
  }
});
