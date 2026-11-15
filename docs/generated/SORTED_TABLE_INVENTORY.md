# Sorted table inventory (tenant key audit)

Refs #26. Generated from `origin/main` at commit `5109a70` (migrations 001 to 209, seed files excluded).

## How this was produced, and what it does not prove

- **Static review only.** A script read the SQL text of the migration files. It did not replay them on PostgreSQL.
  An attempt to replay on a scratch PostgreSQL 16 cluster was blocked by the sandbox user permissions.
  Re-run the replay before relying on any single row.
- The script handles `CREATE TABLE`, `DROP TABLE`, `ALTER TABLE ... RENAME TO`, `ENABLE ROW LEVEL SECURITY`,
  `ADD COLUMN` and `RENAME COLUMN` for `account_id` and `company_id`. It does not read columns added inside
  a PL/pgSQL loop. Migration 205 adds a `company_id` mirror to every table that has `account_id` through such a loop, so
  its `company_id` mirror is **not** shown in the column below. The mirror is from the 205 header comment only.
- Purpose, owner and keys are **not** filled in yet. Only the tenant column, RLS flag and creating migration are shown.

## Summary

- Live tables found: 100.
- Tenant table on `account_id` (with the 205 mirror `company_id` expected): 74. All of them have RLS enabled in the migration text.
- Table created on `company_id` only: 3 (`scheduled_booking_links`, `scheduled_booking_receipts`, `scheduled_customer_links`, from migration 209).
- No direct tenant column found: 23. Each one is either a child of a tenant table (tenant through a foreign key) or global reference data. The owner must classify each one, as the Central README requires for global data.

## Tables with no direct tenant column (classification needed)

- `_migration_161_ignored_candidates` (created in 161_ignore_far_visit_candidates.sql)
- `accounts` (created in 001_core_schema.sql)
- `change_order_line_items` (created in 022_change_orders.sql)
- `companies` (created in 205_company_foundation.sql)
- `complexity_factors` (created in 068_scope_intelligence.sql)
- `estimate_line_items` (created in 001_core_schema.sql)
- `estimate_options` (created in 020_multi_option_estimates.sql)
- `estimate_scope_snapshots` (created in 068_scope_intelligence.sql)
- `invoice_line_items` (created in 001_core_schema.sql)
- `portal_magic_links` (created in 067_portal_auth.sql)
- `portal_sessions` (created in 067_portal_auth.sql)
- `price_book` (created in 018_price_book.sql)
- `price_book_material_templates` (created in 173_materials_builder_templates.sql)
- `price_book_modifiers` (created in 042_price_book_enriched.sql)
- `production_rate_modifiers` (created in 090_production_rates.sql)
- `production_rates` (created in 090_production_rates.sql)
- `profitability_rules` (created in 068_scope_intelligence.sql)
- `scope_components` (created in 068_scope_intelligence.sql)
- `scope_templates` (created in 068_scope_intelligence.sql)
- `service_materials` (created in 070_service_materials.sql)
- `trades` (created in 092_trades_catalog.sql)
- `vehicle_session_activities` (created in 083_vehicle_sessions.sql)
- `work_order_materials` (created in 125_work_orders.sql)

## All live tables

| Table | Created in | Tenant column (static) | RLS enabled | Renamed from |
|---|---|---|---|---|
| `_migration_161_ignored_candidates` | 161_ignore_far_visit_candidates.sql | none found | no |  |
| `account_supplier_preferences` | 171_job_store_run.sql | account_id | yes |  |
| `accounts` | 001_core_schema.sql | none found | yes |  |
| `action_items` | 084_action_items.sql | account_id | yes |  |
| `activity_entries` | 111_activity_entries.sql | account_id | yes |  |
| `asset_links` | 012_asset_links.sql | account_id | yes |  |
| `attention_events` | 165_attention_events.sql | account_id | yes |  |
| `audit_log` | 001_core_schema.sql | account_id | yes |  |
| `automation_settings` | 061_automation_rules.sql | account_id | yes | automation_rules |
| `automations` | 001_core_schema.sql | account_id | yes |  |
| `booking_requests` | 021_booking_requests.sql | account_id | yes |  |
| `business_days` | 127_business_days.sql | account_id | yes |  |
| `business_pricing_settings` | 151_business_pricing_settings.sql | account_id | yes |  |
| `business_travel_settings` | 148_travel_mileage_system.sql | account_id | yes |  |
| `capture_evidence` | 175_capture_evidence.sql | account_id | yes |  |
| `change_order_line_items` | 022_change_orders.sql | none found | yes |  |
| `change_orders` | 022_change_orders.sql | account_id | yes |  |
| `clients` | 001_core_schema.sql | account_id | yes |  |
| `communications_log` | 041_communications_log.sql | account_id | yes |  |
| `companies` | 205_company_foundation.sql | none found | yes |  |
| `completion_packets` | 039_completion_packets.sql | account_id | yes |  |
| `complexity_factors` | 068_scope_intelligence.sql | none found | yes |  |
| `document_links` | 010_document_links.sql | account_id | yes |  |
| `estimate_line_items` | 001_core_schema.sql | none found | yes |  |
| `estimate_options` | 020_multi_option_estimates.sql | none found | yes |  |
| `estimate_scope_snapshots` | 068_scope_intelligence.sql | none found | yes |  |
| `estimates` | 001_core_schema.sql | account_id | yes |  |
| `expense_line_items` | 143_expense_line_items.sql | account_id | yes |  |
| `expenses` | 007_expenses.sql | account_id | yes |  |
| `intake_invites` | 094_intake_invites.sql | account_id | yes |  |
| `intake_media` | 203_intake_media.sql | account_id | yes |  |
| `integration_settings` | 119_integration_settings.sql | account_id | yes |  |
| `invoice_line_items` | 001_core_schema.sql | none found | yes |  |
| `invoices` | 001_core_schema.sql | account_id | yes |  |
| `job_material_lines` | 166_job_material_lines.sql | account_id | yes |  |
| `jobs` | 001_core_schema.sql | account_id | yes |  |
| `location_events` | 114_location_capture.sql | account_id | yes |  |
| `location_segments` | 114_location_capture.sql | account_id | yes |  |
| `maintenance_plans` | 015_client_portal.sql | account_id | yes |  |
| `materials_price_book` | 086_materials_price_book.sql | account_id | yes |  |
| `membership_pricing_structures` | 030_membership_pricing_structures.sql | account_id | yes |  |
| `mileage_logs` | 008_mileage_logs.sql | account_id | yes |  |
| `mileage_rates` | 148_travel_mileage_system.sql | account_id | yes |  |
| `notification_cooldowns` | 061_automation_rules.sql | account_id | yes |  |
| `notification_queue` | 060_notification_queue.sql | account_id | yes |  |
| `payments` | 001_core_schema.sql | account_id | yes |  |
| `period_closes` | 009_period_closes.sql | account_id | yes |  |
| `plan_addons` | 045_plan_templates_and_addons.sql | account_id | yes |  |
| `plan_templates` | 045_plan_templates_and_addons.sql | account_id | yes |  |
| `portal_job_updates` | 198_portal_job_updates.sql | account_id | yes |  |
| `portal_magic_links` | 067_portal_auth.sql | none found | yes |  |
| `portal_sessions` | 067_portal_auth.sql | none found | yes |  |
| `price_book` | 018_price_book.sql | none found | yes |  |
| `price_book_material_templates` | 173_materials_builder_templates.sql | none found | yes |  |
| `price_book_modifiers` | 042_price_book_enriched.sql | none found | yes |  |
| `pricing_rule_snapshots` | 046_estimate_engine.sql | account_id | yes |  |
| `production_rate_modifiers` | 090_production_rates.sql | none found | yes |  |
| `production_rates` | 090_production_rates.sql | none found | yes |  |
| `profitability_rules` | 068_scope_intelligence.sql | none found | yes |  |
| `properties` | 001_core_schema.sql | account_id | yes |  |
| `property_condition_snapshots` | 052_property_condition_snapshots.sql | account_id | yes |  |
| `property_contacts` | 194_realtor_sponsored_property_work.sql | account_id | yes |  |
| `property_issues` | 053_property_issues.sql | account_id | yes |  |
| `property_notes` | 054_property_notes.sql | account_id | yes |  |
| `property_vault_item_media` | 033_vault_item_media.sql | account_id | yes |  |
| `property_vault_items` | 027_digital_home_vault.sql | account_id | yes |  |
| `push_subscriptions` | 175_push_subscriptions.sql | account_id | yes |  |
| `scheduled_booking_links` | 209_scheduled_booking_links.sql | company_id | yes |  |
| `scheduled_booking_receipts` | 209_scheduled_booking_links.sql | company_id | yes |  |
| `scheduled_customer_links` | 209_scheduled_booking_links.sql | company_id | yes |  |
| `scope_components` | 068_scope_intelligence.sql | none found | yes |  |
| `scope_templates` | 068_scope_intelligence.sql | none found | yes |  |
| `service_materials` | 070_service_materials.sql | none found | yes |  |
| `site_visit_assessments` | 085_site_visit_assessments.sql | account_id | yes |  |
| `status_history` | 036_status_history.sql | account_id | yes |  |
| `subscription_addons` | 045_plan_templates_and_addons.sql | account_id | yes |  |
| `time_clock_sessions` | 129_time_clock_sessions.sql | account_id | yes |  |
| `trades` | 092_trades_catalog.sql | none found | yes |  |
| `travel_calculation_snapshots` | 148_travel_mileage_system.sql | account_id | yes |  |
| `user_prompt_mutes` | 147_user_prompt_mutes.sql | account_id | yes |  |
| `users` | 001_core_schema.sql | account_id | yes |  |
| `vehicle_fuel_logs` | 170_vehicle_cost_of_ownership.sql | account_id | yes |  |
| `vehicle_loans` | 170_vehicle_cost_of_ownership.sql | account_id | yes |  |
| `vehicle_renewal_records` | 170_vehicle_cost_of_ownership.sql | account_id | yes |  |
| `vehicle_renewals` | 170_vehicle_cost_of_ownership.sql | account_id | yes |  |
| `vehicle_service_records` | 170_vehicle_cost_of_ownership.sql | account_id | yes |  |
| `vehicle_service_schedules` | 170_vehicle_cost_of_ownership.sql | account_id | yes |  |
| `vehicle_session_activities` | 083_vehicle_sessions.sql | none found | yes |  |
| `vehicle_sessions` | 083_vehicle_sessions.sql | account_id | yes |  |
| `vehicles` | 081_vehicles.sql | account_id | yes |  |
| `visit_candidates` | 121_visit_candidates.sql | account_id | yes |  |
| `visit_checklist_items` | 011_visit_checklist.sql | account_id | yes |  |
| `visit_media` | 016_visit_repair_flow.sql | account_id | yes |  |
| `visit_parts` | 016_visit_repair_flow.sql | account_id | yes |  |
| `visit_tasks` | 158_visit_tasks.sql | account_id | yes |  |
| `visits` | 001_core_schema.sql | account_id | yes |  |
| `work_order_materials` | 125_work_orders.sql | none found | yes |  |
| `work_order_tasks` | 155_work_order_tasks.sql | account_id | yes |  |
| `work_orders` | 125_work_orders.sql | account_id | yes |  |
| `workflow_events` | 059_workflow_events.sql | account_id | yes |  |

## Known gaps for the lead

- `_migration_161_ignored_candidates` looks like a leftover from a migration. Confirm whether it is still needed.
- Central's `database/table-registry.csv` lists 7 core entries and none for Sorted. Sorted's rows cannot be reconciled against it yet.
- PR #75 renames `account_id` to `company_id` through migration 209_rename_account_id_to_company_id. Main now has a different 209 (`209_scheduled_booking_links.sql`). Migration numbering must be settled before merge.

