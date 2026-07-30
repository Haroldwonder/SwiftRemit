-- Rollback for SR-112: AML/CTF compliance controls
--
-- Order matters: drop children before parents.

DROP TABLE IF EXISTS data_retention_runs;
DROP TABLE IF EXISTS data_retention_policies;

DROP TABLE IF EXISTS travel_rule_thresholds;
DROP TABLE IF EXISTS travel_rule_transfers;

DROP TABLE IF EXISTS sar_report_events;
DROP TABLE IF EXISTS sar_reports;

DROP TABLE IF EXISTS aml_alerts;
DROP TABLE IF EXISTS aml_monitoring_rules;

DROP TABLE IF EXISTS sanctions_screening_results;
DROP TABLE IF EXISTS sanctions_list_entries;
