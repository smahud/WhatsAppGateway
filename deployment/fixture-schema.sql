-- Disposable database only. Never import into an existing JIBAS installation.
CREATE DATABASE jbssms;
CREATE TABLE jbssms.outbox (
  ID BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  InsertIntoDB TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  SendingDateTime DATETIME NULL,
  DestinationNumber VARCHAR(200) NOT NULL,
  Text TEXT NULL,
  TextDecoded TEXT NULL,
  MultiPart ENUM('false','true') DEFAULT 'false',
  CreatorID VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE jbssms.gateway_test_fixture (purpose VARCHAR(60) NOT NULL);
INSERT INTO jbssms.gateway_test_fixture VALUES ('JIBAS WG disposable fixture');
