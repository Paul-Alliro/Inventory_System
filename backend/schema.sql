-- Stockroom inventory system — MySQL schema
-- Run this once against your MySQL server:
--   mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS stockroom
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE stockroom;

CREATE TABLE IF NOT EXISTS items (
  id          VARCHAR(64)     PRIMARY KEY,
  name        VARCHAR(255)    NOT NULL,
  category    VARCHAR(255)    DEFAULT '',
  `condition` ENUM('new','used') NOT NULL DEFAULT 'new',
  unit        VARCHAR(50)     NOT NULL DEFAULT 'pcs',
  unit_cost   DECIMAL(12,2)   DEFAULT NULL,
  threshold   INT             NOT NULL DEFAULT 5,
  quantity    INT             NOT NULL DEFAULT 0,
  sku         VARCHAR(50)     UNIQUE,
  image       LONGTEXT        DEFAULT NULL,
  created_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id         VARCHAR(64)  PRIMARY KEY,
  item_id    VARCHAR(64)  NOT NULL,
  item_name  VARCHAR(255) NOT NULL,
  type       ENUM('stock_in','stock_out') NOT NULL,
  qty        INT          NOT NULL,
  remarks    TEXT,
  ts         BIGINT       NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  INDEX idx_item_id (item_id),
  INDEX idx_ts (ts)
) ENGINE=InnoDB;

-- Single-row counter used to generate sequential SKUs like UTC-0001, UTC-0002, ...
CREATE TABLE IF NOT EXISTS sku_counter (
  id      INT PRIMARY KEY DEFAULT 1,
  counter INT NOT NULL DEFAULT 1
) ENGINE=InnoDB;

INSERT INTO sku_counter (id, counter)
  VALUES (1, 1)
  ON DUPLICATE KEY UPDATE id = id;
