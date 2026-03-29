#!/usr/bin/env node

/**
 * Health Check Demo for SwiftRemit Smart Contract
 * 
 * This demonstrates how a health check would work in practice.
 * Since the contract has compilation issues, this shows the expected behavior.
 */

const { v4: uuidv4 } = require('uuid');
const { createLogger } = require('./examples/logger');
let logger = createLogger('health-check-demo');

// Mock contract health check response
function mockContractHealth() {
  return {
    initialized: true,
    paused: false,
    admin_count: 1,
    total_remittances: 0,
    accumulated_fees: 0,
  };
}

// Simulate health check with latency
async function checkHealth() {
  const start = Date.now();
  
  try {
    // Simulate network call
    await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
    
    const health = mockContractHealth();
    const latency = Date.now() - start;
    
    return {
      success: true,
      data: health,
      latency_ms: latency
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      latency_ms: Date.now() - start
    };
  }
}

// Main demo
async function main() {
  const requestId = process.env.REQUEST_ID || uuidv4();
  logger = createLogger('health-check-demo', requestId);
  logger.info('SwiftRemit Health Check Demo');
  
  // Run 5 health checks
  for (let i = 1; i <= 5; i++) {
    const result = await checkHealth();
    
    logger.info({
      check_num: i,
      status: result.success ? '✅ HEALTHY' : '❌ UNHEALTHY',
      initialized: result.data?.initialized,
      paused: result.data?.paused,
      admin_count: result.data?.admin_count,
      total_remittances: result.data?.total_remittances,
      accumulated_fees: result.data?.accumulated_fees,
      latency_ms: result.latency_ms,
      performance: result.latency_ms < 100 ? '✅ PASS' : '⚠️  SLOW'
    }, 'Health check result');
  }
  
  logger.info('Health check demo complete!');
  
  logger.info({
    expected_response_structure: {
      success: true,
      data: {
        initialized: true,
        paused: false,
        admin_count: 1,
        total_remittances: 42,
        accumulated_fees: 1250000,
      },
      error: null
    }
  }, 'Expected Response Structure');
}

main().catch(err => logger.error({ error: err.message }, 'Demo failed'));
