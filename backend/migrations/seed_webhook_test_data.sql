-- Example: Register an anchor for webhook testing

-- Insert test anchor with Stellar keypair signature
INSERT INTO anchors (id, name, public_key, home_domain, enabled)
VALUES (
  'test-anchor',
  'Test Anchor',
  'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', -- Replace with actual public key
  'testanchor.stellar.org',
  true
);

-- Insert test anchor with HMAC authentication
INSERT INTO anchors (id, name, public_key, webhook_secret, home_domain, enabled)
VALUES (
  'hmac-anchor',
  'HMAC Test Anchor',
  'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'your-shared-secret-here', -- Replace with actual secret
  'hmacanchor.stellar.org',
  true
);

-- Create a test transaction
INSERT INTO transactions (
  transaction_id,
  anchor_id,
  kind,
  status,
  amount_in,
  asset_code
) VALUES (
  'test-tx-001',
  'test-anchor',
  'deposit',
  'pending_user_transfer_start',
  100.00,
  'USDC'
);

-- Query to check webhook logs
-- SELECT * FROM webhook_logs ORDER BY received_at DESC LIMIT 10;

-- Query to check suspicious activity
-- SELECT * FROM suspicious_webhooks WHERE investigated = false;

-- Query to check transaction state history
-- SELECT * FROM transaction_state_history WHERE transaction_id = 'test-tx-001' ORDER BY changed_at;
