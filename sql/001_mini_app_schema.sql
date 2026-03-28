CREATE TABLE IF NOT EXISTS clients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_name VARCHAR(191) NOT NULL,
    phone VARCHAR(50) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS users (
    tg_id BIGINT NOT NULL,
    full_name VARCHAR(191) NOT NULL,
    tech_key VARCHAR(50) NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'technician',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tg_id),
    KEY idx_users_active_name (is_active, full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS cards (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id BIGINT UNSIGNED NULL,
    assigned_to BIGINT NULL,
    category VARCHAR(100) NULL,
    problem_type VARCHAR(255) NULL,
    work_type VARCHAR(255) NULL,
    address_raw VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'new',
    payment_status VARCHAR(50) NULL,
    group_chat_id VARCHAR(50) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cards_status_created (status, created_at),
    KEY idx_cards_client (client_id),
    KEY idx_cards_assigned (assigned_to),
    CONSTRAINT fk_cards_client
        FOREIGN KEY (client_id) REFERENCES clients(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,
    CONSTRAINT fk_cards_assigned_user
        FOREIGN KEY (assigned_to) REFERENCES users(tg_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    card_id BIGINT UNSIGNED NOT NULL,
    payment_method VARCHAR(100) NULL,
    payment_method_code VARCHAR(100) NULL,
    payment_type VARCHAR(100) NULL,
    invoice_number VARCHAR(100) NULL,
    amount_excl_vat DECIMAL(10,2) NULL,
    receiver_scope VARCHAR(100) NULL,
    created_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_payments_card_created (card_id, created_at),
    KEY idx_payments_invoice (invoice_number),
    CONSTRAINT fk_payments_card
        FOREIGN KEY (card_id) REFERENCES cards(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS afspraak (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    card_id BIGINT UNSIGNED NOT NULL,
    scheduled_at DATETIME NOT NULL,
    afspraak_type VARCHAR(50) NOT NULL DEFAULT 'other',
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_afspraak_card_status_created (card_id, status, created_at),
    KEY idx_afspraak_scheduled (scheduled_at),
    CONSTRAINT fk_afspraak_card
        FOREIGN KEY (card_id) REFERENCES cards(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
