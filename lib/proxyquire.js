'use strict';
/*jshint laxbreak:true, loopfunc:true*/

var path = require('path')
  , Module = require('module')
  , resolve = require('resolve')
  , dirname = require('path').dirname
  , ProxyquireError = require('./proxyquire-error')
  , is = require('./is')
  , assert = require('assert')
  , fillMissingKeys = require('fill-keys')
  , moduleNotFoundError = require('module-not-found-error')
  , hasOwnProperty = Object.prototype.hasOwnProperty
  ;

function validateArguments(request, stubs) {
  var msg = (function getMessage() {
    if (!request)
      return 'Missing argument: "request". Need it to resolve desired module.';

    if (!stubs)
      return 'Missing argument: "stubs". If no stubbing is needed, use regular require instead.';

    if (!is.String(request))
      return 'Invalid argument: "request". Needs to be a requirable string that is the module to load.';

    if (!is.Object(stubs))
      return 'Invalid argument: "stubs". Needs to be an object containing overrides e.g., {"path": { extname: function () { ... } } }.';
  })();

  if (msg) throw new ProxyquireError(msg);
}

function defaultNameResolver(stubs, fileName) {
  if (stubs.hasOwnProperty(fileName)) {
    return {
      key: fileName,
      stub: stubs[fileName]
    };
  }
}

function resolveStub(stubs, fileName, module) {
  return (this._nameResolver ? this._nameResolver : defaultNameResolver)(stubs, fileName, module.filename);
}

/**
 * @name Proxyquire
 * @class
 * @constructor
 * Proxies imports/require in order to allow overriding dependencies during testing.
 */
function Proxyquire(parent) {
  var self = this
    , fn = self.load.bind(self)
    , proto = Proxyquire.prototype
    ;

  this._parent = parent;
  this._preserveCache = true;
  this._nameResolver = undefined;
  this._noCallThru = undefined;
  this._noUnusedStubs = undefined;
  this._stubsUsed = undefined;


  Object.keys(proto)
    .forEach(function (key) {
      if (is.Function(proto[key])) fn[key] = self[key].bind(self);
    });

  self.fn = fn;
  return fn;
}

Proxyquire.prototype = Object.assign(Proxyquire.prototype, /** @lends Proxyquire.prototype*/ {
  /**
   * Forks proxyquire.
   * @name fork
   * @function
   * @return {object} Forked proxyquire function to allow chaining
   * @example
   * proxyquire.noCallThru() - will disable call throught on proxyquire.
   * proxyquire.load - call throught will be still disabled
   * proxyquire.fork().noCallThru() - will create a separate fork of proxyquire which will not affect original one
   */
  fork: function (fn) {
    var result = new Proxyquire(this._parent);
    // copy all own props, except bounded functions
    for (var i in this) {
      if (this.hasOwnProperty(i) && !(i in this.prototype)) {
        result[i] = this[i];
      }
    }
    return result;
  },

  /**
   * Sets new module name resolver and comparator
   * @name resolveNames
   * @function
   * @param {Function} [resolver](subs, fileName, currentDir).
   * @return {object} The proxyquire function to allow chaining
   *
   * @example proxyquire.resolveNames((stubs, fileName) => stubs.hasOwnProperty(fileName) ? stubs[fileName] : null)
   */
  resolveNames: function (fn) {
    this._nameResolver = fn;
    return this.fn;
  },

  /**
   * Disables call thru, which determines if keys of original modules will be used
   * when they weren't stubbed out.
   * @name noCallThru
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  noCallThru: function () {
    this._noCallThru = true;
    return this.fn;
  },

  /**
   * Enables call thru, which determines if keys of original modules will be used
   * when they weren't stubbed out.
   * @name callThru
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  callThru: function () {
    this._noCallThru = false;
    return this.fn;
  },

  /**
   * Throws an error is some stubs are unused
   * @name noUnusedStubs
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  noUnusedStubs: function () {
    this._noUnusedStubs = true;
    return this.fn;
  },

  /**
   * Restores default behavior - allows any stubs
   * @name anyStub
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  anyStub: function () {
    this._noUnusedStubs = false;
    return this.fn;
  },

  /**
   * Throws an error is some deps are not mocked
   * @name noUnmockedStubs
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  noUnmockedStubs: function () {
    this._noUnmockedStubs = true;
    return this.fn;
  },

  /**
   * Restores default behavior - allows unmocked deps
   * @name withUnmockedStubs
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  withUnmockedStubs: function () {
    this._noUnmockedStubs = false;
    return this.fn;
  },


  /**
   * Will make proxyquire remove the requested modules from the `require.cache` in order to force
   * them to be reloaded the next time they are proxyquired.
   * This behavior differs from the way nodejs `require` works, but for some tests this maybe useful.
   *
   * @name noPreserveCache
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  noPreserveCache: function () {
    this._preserveCache = false;
    return this.fn;
  },

  /**
   * Restores proxyquire caching behavior to match the one of nodejs `require`
   *
   * @name preserveCache
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  preserveCache: function () {
    this._preserveCache = true;
    return this.fn;
  },

  /**
   * Prevent modules from node_modules to be wiped from a cache
   *
   * @name onlyForProjectFiles
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  onlyForProjectFiles: function () {
    this._onlyForProjectFiles = true;
    return this.fn;
  },

  /**
   * Restores default behavior - all modules can be wiped from a cache
   *
   * @name forAllFiles
   * @function
   * @return {object} The proxyquire function to allow chaining
   */
  forAllFiles: function () {
    this._onlyForProjectFiles = false;
    return this.fn;
  },


  /**
   * Loads a module using the given stubs instead of their normally resolved required modules.
   * @param request The requirable module path to load.
   * @param stubs The stubs to use. e.g., { "path": { extname: function () { ... } } }
   * @return {*} A newly resolved module with the given stubs.
   */
  load: function (request, stubs) {
    validateArguments(request, stubs);

    // Find out if any of the passed stubs are global overrides
    for (var key in stubs) {
      var stub = stubs[key];

      if (stub === null) continue;

      if (typeof stub === 'undefined') {
        throw new ProxyquireError('Invalid stub: "' + key + '" cannot be undefined');
      }

      if (hasOwnProperty.call(stub, '@global')) {
        this._containsGlobal = true;
      }

      if (hasOwnProperty.call(stub, '@runtimeGlobal')) {
        this._containsGlobal = true;
        this._containsRuntimeGlobal = true;
      }
    }

    this._stubsUsed = {};
    // Ignore the module cache when return the requested module
    var result = this._withoutCache(this._parent, stubs, request, this._parent.require.bind(this._parent, request));

    if (this._noUnusedStubs) {
      for (var key in stubs) {
        if (!this._stubsUsed[key]) {
          throw new Error('proxyquire: stub `' + key + '` dont match any require');
        }
      }
    }
    return result;
  },

// This replaces a module's require function
  _require: function (module, stubs, path) {
    assert(typeof path === 'string', 'path must be a string');
    assert(path, 'missing path');

    var stubRecord = resolveStub.call(this, stubs, path, module);
    if (typeof stubRecord != 'undefined') {
      var stub = stubRecord.stub;

      if (stub === null) {
        // Mimic the module-not-found exception thrown by node.js.
        throw moduleNotFoundError(path);
      }

      this._stubsUsed[stubRecord.key] = (this._stubsUsed[stubRecord.key] || 0) + 1;

      if (hasOwnProperty.call(stub, '@noCallThru') ? !stub['@noCallThru'] : !this._noCallThru) {
        fillMissingKeys(stub, Module._load(path, module));
      }

      // We are top level or this stub is marked as global or we should always override
      if (module.parent == this._parent
        || hasOwnProperty.call(stub, '@global')
        || hasOwnProperty.call(stub, '@runtimeGlobal')
        || hasOwnProperty.call(stub, '@override')) {
        return stub;
      }
    } else {
      if (this._noUnmockedStubs && module.parent == this._parent) {
        throw new Error('proxyquire: dependency `' + path + ' of `' + this._parent + '` is is not mocked');
      }
    }

    // Only ignore the cache if we have global stubs
    if (this._containsRuntimeGlobal) {
      return this._withoutCache(module, stubs, path, Module._load.bind(Module, path, module));
    } else {
      return Module._load(path, module);
    }
  },

  _withoutCache: function (module, stubs, path, func) {
    // Temporarily disable the cache - either per-module or globally if we have global stubs
    var restoreCache = this._disableCache(module, path);

    // Override all require extension handlers
    var restoreExtensionHandlers = this._overrideExtensionHandlers(module, stubs);

    try {
      // Execute the function that needs the module cache disabled
      return func();
    } finally {
      // Restore the cache if we are preserving it
      if (this._preserveCache) {
        restoreCache();
      } else {
        var id = Module._resolveFilename(path, module);
        var stubIds = Object.keys(stubs).map(function (stubPath) {
          try {
            return resolve.sync(stubPath, {
              basedir: dirname(id),
              extensions: Object.keys(require.extensions),
              paths: Module.globalPaths
            })
          } catch (_) {
          }
        });
        var ids = [id].concat(stubIds.filter(Boolean));

        ids.forEach(function (id) {
          delete require.cache[id];
        });
      }

      // Finally restore the original extension handlers
      restoreExtensionHandlers();
    }
  },

  _disableCache: function (module, path) {
    if (this._containsGlobal) {
      // empty the require cache because if we are stubbing C but requiring A,
      // and if A requires B and B requires C, then B and C might be cached already
      // and we'll never get the chance to return our stub
      return this._disableGlobalCache();
    }

    // Temporarily delete the SUT from the require cache
    return this._disableModuleCache(path, module);
  },

  _disableGlobalCache: function () {
    var cache = require.cache;
    var keepModules = this._onlyForProjectFiles;
    require.cache = Module._cache = {};

    function wipeCache(cache, restoredCache, target) {
      for (var id in cache) {
        if (
          // Keep native modules (i.e. `.node` files).
        // Otherwise, Node.js would throw a “Module did not self-register”
        // error upon requiring it a second time.
        // See https://github.com/nodejs/node/issues/5016.
        (/\.node$/.test(id)) ||

        // Keep third party modules, i.e. node_modules
        // Otherwise, you will erase something you might not touch
        // and few things, React, may just broke
        (/\/node_modules\//.test(id) && keepModules) ||
        //
        0) {
          target[id] = cache[id];
        }
      }
      return restoredCache;
    }

    wipeCache(cache, {}, require.cache);

    // Return a function that will undo what we just did
    return function () {
      // Keep native modules which were added to the cache in the meantime.

      require.cache = Module._cache = wipeCache(require.cache, cache, cache);
    };
  },

  _disableModuleCache: function (path, module) {
    // Find the ID (location) of the SUT, relative to the parent
    var id = Module._resolveFilename(path, module);

    var cached = Module._cache[id];
    delete Module._cache[id];

    // Return a function that will undo what we just did
    return function () {
      if (cached) {
        Module._cache[id] = cached;
      }
    };
  },

  _overrideExtensionHandlers: function (module, stubs) {
    var originalExtensions = {};
    var self = this;

    Object.keys(require.extensions).forEach(function (extension) {
      // Store the original so we can restore it later
      if (!originalExtensions[extension]) {
        originalExtensions[extension] = require.extensions[extension];
      }

      // Override the default handler for the requested file extension
      require.extensions[extension] = function (module, filename) {
        // Override the require method for this module
        module.require = self._require.bind(self, module, stubs);

        return originalExtensions[extension](module, filename);
      };
    });

    // Return a function that will undo what we just did
    return function () {
      Object.keys(originalExtensions).forEach(function (extension) {
        require.extensions[extension] = originalExtensions[extension];
      });
    };
  }
});

module.exports = Proxyquire;
