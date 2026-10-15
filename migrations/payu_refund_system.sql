-- ─────────────────────────────────────────────────────────────
-- PayU refund system: admin-approval setting, webhook events,
-- and real PayU transaction ids on refunds & bookings.
-- ─────────────────────────────────────────────────────────────

-- 1. Refund admin approval setting
INSERT INTO system_settings (`key`, `value`, `label`, `description`, `group`, `type`, `created_at`, `updated_at`)
VALUES (
  'refund_admin_approval_required', 'true',
  'Require admin approval for PayU refunds',
  'When enabled (true), bank refunds via PayU need admin approval before initiation. When disabled (false), the refund is sent to PayU automatically as soon as the user cancels.',
  'refund', 'boolean', NOW(), NOW()
)
ON DUPLICATE KEY UPDATE `updated_at` = NOW();

-- 2. Real PayU ids stored on refunds
ALTER TABLE `refunds`
  ADD COLUMN `payu_txnid` VARCHAR(100) DEFAULT NULL AFTER `gateway_refund_id`,
  ADD COLUMN `payu_mihpayid` VARCHAR(100) DEFAULT NULL AFTER `payu_txnid`;

-- 3. Real PayU mihpayid on bookings (transaction_id holds our own OC... txnid)
ALTER TABLE `bookings`
  ADD COLUMN `payu_mihpayid` VARCHAR(100) DEFAULT NULL AFTER `transaction_id`;

-- 4. PayU webhook event log
CREATE TABLE IF NOT EXISTS `payu_webhooks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_type` VARCHAR(100) DEFAULT NULL,
  `payu_txnid` VARCHAR(100) DEFAULT NULL,
  `payu_mihpayid` VARCHAR(100) DEFAULT NULL,
  `booking_id` INT UNSIGNED DEFAULT NULL,
  `payment_id` INT UNSIGNED DEFAULT NULL,
  `refund_id` INT UNSIGNED DEFAULT NULL,
  `status` VARCHAR(50) DEFAULT NULL,
  `amount` DECIMAL(10,2) DEFAULT NULL,
  `payload` JSON DEFAULT NULL,
  `hash_verified` TINYINT(1) DEFAULT 0,
  `processed` TINYINT(1) DEFAULT 0,
  `processed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME DEFAULT NULL,
  `updated_at` DATETIME DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_payu_webhooks_txnid` (`payu_txnid`),
  KEY `idx_payu_webhooks_mihpayid` (`payu_mihpayid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
