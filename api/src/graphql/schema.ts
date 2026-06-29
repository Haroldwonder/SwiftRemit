import { buildSchema } from 'graphql';

export const typeDefs = buildSchema(`
  type Remittance {
    id: Int!
    sender: String!
    agent: String!
    amount: Float!
    fee: Float!
    status: String!
    token: String
    memo: String
    created_at: String!
    updated_at: String!
  }

  type Corridor {
    source_currency: String!
    destination_country: String!
    total_volume: Float!
    transaction_count: Int!
    success_count: Int!
    failure_count: Int!
    success_rate: Float!
    avg_fee: Float!
    total_fees: Float!
  }

  type TimeSeriesPoint {
    timestamp: String!
    volume: Float!
    transaction_count: Int!
    fees: Float!
  }

  type TimeSeries {
    corridor: String!
    interval: String!
    range: String!
    data: [TimeSeriesPoint!]!
  }

  type Agent {
    address: String!
    registered_at: String!
    is_active: Boolean!
  }

  type Query {
    remittances(
      agent: String
      status: String
      cursor: String
      limit: Int = 20
    ): [Remittance!]!

    remittance(id: Int!): Remittance

    corridors(range: String = "30d"): [Corridor!]!

    timeSeries(
      corridor: String!
      interval: String = "1d"
      range: String = "30d"
    ): TimeSeries

    agents: [Agent!]!

    agent(address: String!): Agent
  }
`);
