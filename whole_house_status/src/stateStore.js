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
        // Skip the invalid entry and keep the remaining valid states.
        continue;
      }

      try {
        nextStates.set(state.entity_id, structuredClone(state));
      } catch {
        // Skip non-cloneable entries without discarding the valid ones.
        continue;
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

  getStateMap(predicate) {
    const result = {};
    for (const [entityId, state] of this.states) {
      if (predicate && !predicate(state)) {
        continue;
      }
      result[entityId] = structuredClone(state);
    }
    return result;
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
