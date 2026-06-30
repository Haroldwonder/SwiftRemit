-- Rollback for seed_webhook_test_data.sql
-- Removes webhook test anchor and transaction data.

DELETE FROM transactions
WHERE transaction_id = 'test-tx-001';

DELETE FROM anchors
WHERE id IN ('test-anchor', 'hmac-anchor');
