class StateStore {
  constructor() {
    this.states = new Map();
  }

  setStates(states) {
    this.states.clear();
    for (const state of states) {
      if (state && state.entity_id) {
        this.states.set(state.entity_id, state);
      }
    }
  }

  applyStateChanged(event) {
    const newState = event && event.data && event.data.new_state;
    const entityId = event && event.data && event.data.entity_id;
    if (newState && newState.entity_id) {
      this.states.set(newState.entity_id, newState);
    } else if (entityId) {
      this.states.delete(entityId);
    }
  }

  getStateMap() {
    return Object.fromEntries(this.states.entries());
  }

  getStates() {
    return [...this.states.values()];
  }
}

module.exports = {
  StateStore
};
