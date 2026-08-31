-- SR-159: Postgres-backed agent store for the REST API layer.
--
-- The GraphQL layer already queries an `agents` table (graphql/resolvers.ts).
-- This creates `api_agents` for the REST API to avoid a schema conflict while
-- both coexist.  A future consolidation can UNION or rename as appropriate.

CREATE TABLE IF NOT EXISTS api_agents (
  id               VARCHAR(56)  PRIMARY KEY,
  stellar_address  VARCHAR(56)  NOT NULL UNIQUE,
  payout_address   TEXT         NOT NULL,
  name             VARCHAR(255) NOT NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'suspended')),
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_agents_stellar_address ON api_agents(stellar_address);
CREATE INDEX IF NOT EXISTS idx_api_agents_status ON api_agents(status);
