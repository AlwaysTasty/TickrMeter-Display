'use strict';

// Metadata only: safe to bundle in the browser without Node crypto/zlib shims.
// Validate uploaded files through the authenticated API or Node SDK.
module.exports = { ...require('./constants'), schemas: { feed: require('./schemas/feed.schema.json') } };
