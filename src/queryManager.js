import shallowEqual from "shallow-equal/objects";
import { setPendingResultSymbol, setResultsSymbol, getFromCacheSymbol } from "./cache";

const deConstructQueryPacket = packet => {
  if (typeof packet === "string") {
    return [packet, null, {}];
  } else if (Array.isArray(packet)) {
    return [packet[0], packet[1] || null, packet[2] || {}];
  }
};

export default class QueryManager {
  mutationSubscription = null;
  static initialState = {
    loading: false,
    loaded: false,
    data: null,
    error: null
  };
  currentState = { ...QueryManager.initialState };

  constructor({ client, setState, cache }, packet) {
    const [query, variables, options] = deConstructQueryPacket(packet);
    this.client = client;
    this.setState = setState;
    this.cache = cache || client.getCache(query) || client.newCacheForQuery(query);
    this.query = query;
    this.variables = variables;
    if (typeof options.onMutation === "object") {
      if (!Array.isArray(options.onMutation)) {
        options.onMutation = [options.onMutation];
      }
      this.mutationSubscription = this.client.subscribeMutation(options.onMutation, {
        cache: this.cache,
        softReset: this.softReset,
        hardReset: this.hardReset,
        refresh: this.refresh,
        currentResults: () => this.currentState.data
      });
    }
    this.currentState.reload = this.reload;
    this.currentState.clearCache = () => this.cache.clearCache();
    this.currentState.clearCacheAndReload = this.clearCacheAndReload;
  }
  updateState = newState => {
    Object.assign(this.currentState, newState);
    this.setState(this.currentState);
  };
  updateIfNeeded(packet, force) {
    const [query, variables] = deConstructQueryPacket(packet);
    if (force || !shallowEqual(variables || {}, this.variables || {})) {
      this.query = query;
      this.variables = variables;
      this.load();
    }
  }
  refresh = () => {
    this.load();
  };
  softReset = newResults => {
    this.cache.clearCache();
    this.updateState({ data: newResults });
  };
  hardReset = () => {
    this.cache.clearCache();
    this.reload();
  };
  clearCacheAndReload = () => {
    this.cache.clearCache();
    this.reload();
  };
  reload = () => {
    let graphqlQuery = this.client.getGraphqlQuery({ query: this.query, variables: this.variables || null });
    this.execute(graphqlQuery);
  };
  load() {
    let graphqlQuery = this.client.getGraphqlQuery({ query: this.query, variables: this.variables || null });
    this.cache[getFromCacheSymbol](
      graphqlQuery,
      promise => {
        Promise.resolve(promise).then(() => {
          //cache should now be updated, unless it was cleared. Either way, re-run this method
          this.load();
        });
      },
      cachedEntry => {
        this.updateState({ data: cachedEntry.data, error: cachedEntry.error, loading: false, loaded: true });
      },
      () => this.execute(graphqlQuery)
    );
  }
  execute(graphqlQuery) {
    this.updateState({ loading: true });
    let promise = this.client.runQuery(this.query, this.variables);
    this.cache[setPendingResultSymbol](graphqlQuery, promise);
    this.handleExecution(promise, graphqlQuery);
  }
  handleExecution = (promise, cacheKey) => {
    this.currentPromise = promise;
    Promise.resolve(promise)
      .then(resp => {
        if (this.currentPromise !== promise) {
          return;
        }
        this.cache[setResultsSymbol](promise, cacheKey, resp);

        if (resp.errors) {
          this.updateState({ loaded: true, loading: false, data: null, error: resp.errors });
        } else {
          this.updateState({ loaded: true, loading: false, data: resp.data, error: null });
        }
      })
      .catch(err => {
        this.cache[setResultsSymbol](promise, cacheKey, null, err);
        this.updateState({ loaded: true, loading: false, data: null, error: err });
      });
  };
  dispose() {
    this.mutationSubscription && this.mutationSubscription();
  }
}
