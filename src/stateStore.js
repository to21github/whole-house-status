class StateStore {
  constructor() {
    this.states = new Map();
  }

  setStates(states) {
    if (!Array.isArray(states)) {
      return;
    }

    const nextStates = new Map();
    for (const state of states) {
      if (!isValidState(state)) {
        return;
      }

      try {
        nextStates.set(state.entity_id, structuredClone(state));
      } catch {
        return;
      }
    }

    this.states = nextStates;
  }

  applyStateChanged(event) {
    const data = event && event.data;
    const entityId = data && typeof data.entity_id === 'string' && data.entity_id;
    if (!entityId) {
      return;
    }

    if (data.new_state === null) {
      this.states.delete(entityId);
      return;
    }

    if (!isValidState(data.new_state) || data.new_state.entity_id !== entityId) {
      return;
    }

    try {
      this.states.set(entityId, structuredClone(data.new_state));
    } catch {
      // Ignore non-cloneable event payloads without changing the last valid state.
    }
  }

  getStateMap() {
    return Object.fromEntries([...this.states.entries()].map(([entityId, state]) => [entityId, structuredClone(state)]));
  }

  getStates() {
    return [...this.states.values()].map((state) => structuredClone(state));
  }
}

function isValidState(state) {
  return Boolean(
    state &&
    typeof state === 'object' &&
    !Array.isArray(state) &&
    typeof state.entity_id === 'string' &&
    state.entity_id
  );
}

module.exports = {
  StateStore
};
