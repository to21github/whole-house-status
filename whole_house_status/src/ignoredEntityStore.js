const fs = require('node:fs');
const path = require('node:path');

const ENTITY_ID_PATTERN = /^[^.]+\.[^.]+$/;

function isEntityId(value) {
  return typeof value === 'string' && value === value.trim() && ENTITY_ID_PATTERN.test(value);
}

class IgnoredEntityStore {
  constructor({
    filePath = process.env.IGNORED_ENTITIES_PATH || '/data/ignored-entities.json',
    logger = console
  } = {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.entityIds = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      return new Set();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return new Set(Array.isArray(parsed) ? parsed.filter(isEntityId) : []);
    } catch (error) {
      this.logger.warn(`Unable to load ignored entities from ${this.filePath}: ${error.message}`);
      return new Set();
    }
  }

  getEntityIds() {
    return new Set(this.entityIds);
  }

  has(entityId) {
    return this.entityIds.has(entityId);
  }

  setIgnored(entityId, ignored) {
    if (!isEntityId(entityId) || typeof ignored !== 'boolean') {
      return false;
    }

    const nextEntityIds = new Set(this.entityIds);
    if (ignored) {
      nextEntityIds.add(entityId);
    } else {
      nextEntityIds.delete(entityId);
    }

    const temporaryPath = `${this.filePath}.tmp`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(temporaryPath, `${JSON.stringify([...nextEntityIds].sort())}\n`, 'utf8');
    fs.renameSync(temporaryPath, this.filePath);
    this.entityIds = nextEntityIds;
    return true;
  }
}

module.exports = {
  IgnoredEntityStore,
  isEntityId
};
