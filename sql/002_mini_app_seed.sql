INSERT INTO clients (id, client_name, phone, created_at)
VALUES
    (1, 'Bahadir Semerci', '0488 11 22 33', NOW() - INTERVAL 5 DAY),
    (2, 'Sophie Van den Broeck', '0472 22 33 44', NOW() - INTERVAL 4 DAY),
    (3, 'Nicolas De Smet', '0494 44 55 66', NOW() - INTERVAL 2 DAY)
ON DUPLICATE KEY UPDATE
    client_name = VALUES(client_name),
    phone = VALUES(phone);


INSERT INTO users (tg_id, full_name, tech_key, role, is_active, created_at)
VALUES
    (7909226479, 'Daniel', 'DAN', 'dispatcher', 1, NOW() - INTERVAL 10 DAY),
    (10001, 'Yassine El Amrani', 'YAS', 'technician', 1, NOW() - INTERVAL 8 DAY),
    (10002, 'Mansour K.', 'MANS', 'technician', 1, NOW() - INTERVAL 8 DAY),
    (10003, 'Isa M.', 'ISA', 'technician', 1, NOW() - INTERVAL 8 DAY)
ON DUPLICATE KEY UPDATE
    full_name = VALUES(full_name),
    tech_key = VALUES(tech_key),
    role = VALUES(role),
    is_active = VALUES(is_active);


INSERT INTO cards (
    id,
    client_id,
    assigned_to,
    category,
    problem_type,
    work_type,
    address_raw,
    status,
    payment_status,
    group_chat_id,
    created_at,
    updated_at
)
VALUES
    (
        101,
        1,
        10001,
        'Slot kapot',
        'Meerpuntsslot draait niet meer',
        'Depannage',
        'Meir 120, 2000 Antwerpen',
        'assigned',
        'unpaid',
        '-1001562342633',
        NOW() - INTERVAL 4 HOUR,
        NOW() - INTERVAL 2 HOUR
    ),
    (
        102,
        2,
        10002,
        'Buitengesloten',
        'Sleutels binnen laten liggen',
        'Spoedinterventie',
        'Stationsstraat 44, 2800 Mechelen',
        'on_the_way',
        'pay_later',
        '-1002340152626',
        NOW() - INTERVAL 2 HOUR,
        NOW() - INTERVAL 45 MINUTE
    ),
    (
        103,
        3,
        10003,
        'Inbraakschade',
        'Cilinder en beslag moeten vervangen worden',
        'Beveiliging',
        'Kortrijksesteenweg 88, 9000 Gent',
        'in_progress',
        'partial',
        '-1002649403969',
        NOW() - INTERVAL 90 MINUTE,
        NOW() - INTERVAL 20 MINUTE
    ),
    (
        104,
        2,
        NULL,
        'Offerte',
        'Nieuwe veiligheidscilinder met kaart',
        'Plaatsing',
        'Bondgenotenlaan 15, 3000 Leuven',
        'waiting_dispatcher',
        'unpaid',
        '-1002276060500',
        NOW() - INTERVAL 30 MINUTE,
        NOW() - INTERVAL 10 MINUTE
    )
ON DUPLICATE KEY UPDATE
    client_id = VALUES(client_id),
    assigned_to = VALUES(assigned_to),
    category = VALUES(category),
    problem_type = VALUES(problem_type),
    work_type = VALUES(work_type),
    address_raw = VALUES(address_raw),
    status = VALUES(status),
    payment_status = VALUES(payment_status),
    group_chat_id = VALUES(group_chat_id),
    updated_at = VALUES(updated_at);


INSERT INTO payments (
    id,
    card_id,
    payment_method,
    payment_method_code,
    payment_type,
    invoice_number,
    amount_excl_vat,
    receiver_scope,
    created_by,
    created_at
)
VALUES
    (
        201,
        101,
        'cash',
        'cash',
        'final',
        'F260683',
        185.00,
        'field',
        7909226479,
        NOW() - INTERVAL 80 MINUTE
    ),
    (
        202,
        103,
        'bancontact',
        'bancontact',
        'partial',
        'F260684',
        95.00,
        'field',
        457141175,
        NOW() - INTERVAL 25 MINUTE
    )
ON DUPLICATE KEY UPDATE
    payment_method = VALUES(payment_method),
    payment_method_code = VALUES(payment_method_code),
    payment_type = VALUES(payment_type),
    invoice_number = VALUES(invoice_number),
    amount_excl_vat = VALUES(amount_excl_vat),
    receiver_scope = VALUES(receiver_scope),
    created_by = VALUES(created_by),
    created_at = VALUES(created_at);


INSERT INTO afspraak (
    id,
    card_id,
    scheduled_at,
    afspraak_type,
    status,
    created_at
)
VALUES
    (
        301,
        101,
        DATE_ADD(CURDATE(), INTERVAL 3 HOUR),
        'second_visit',
        'scheduled',
        NOW() - INTERVAL 30 MINUTE
    ),
    (
        302,
        104,
        DATE_ADD(DATE_ADD(CURDATE(), INTERVAL 1 DAY), INTERVAL 10 HOUR),
        'material',
        'scheduled',
        NOW() - INTERVAL 20 MINUTE
    )
ON DUPLICATE KEY UPDATE
    scheduled_at = VALUES(scheduled_at),
    afspraak_type = VALUES(afspraak_type),
    status = VALUES(status),
    created_at = VALUES(created_at);
