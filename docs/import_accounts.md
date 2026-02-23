# Importación masiva de Cuentas, Contactos y Predios

## 1) Cuentas (desde **Cuentas → Importar CSV**)

Encabezado exacto esperado (fila 1):

`account_name,account_type,visit_frequency_per_month,stage,phone,sheet_count,certificate_count,mail_notice,notes,site_name,site_address,site_city,site_notes`

Columnas soportadas:

- `account_name` (obligatorio)
- `account_type` (`bank`, `building`, `warehouse`, `store`, `plant`, `business`, `commercial`, `residential`)
- `visit_frequency_per_month` (número, default `1`)
- `stage` (`prospect`, `offer_sent`, `negotiation`, `account_active`, `account_inactive`, `closed`)
- `phone`
- `sheet_count` (entero)
- `certificate_count` (entero)
- `mail_notice` (`mail`, `cd`, `sicop`, vacío/sin definir)
- `notes`
- `site_name` (si lo completás, crea predio)
- `site_address`
- `site_city`
- `site_notes`

Reglas:

1. Si la cuenta no existe, se crea.
2. Si la cuenta ya existe (mismo nombre), no se duplica.
3. Si la cuenta importada queda inactiva, no se crean predios para esa fila.
4. Si un predio con mismo `account + site_name + site_address` ya existe, no se duplica.

Template: `docs/import_accounts_template.csv`.

---

## 2) Contactos (desde **Contactos → Importar CSV**)

Encabezado exacto esperado (fila 1):

`account_name,first_name,last_name,role,email,mobile,notes,status`

Columnas soportadas:

- `account_name` (obligatorio, debe existir y estar activa)
- `first_name` (o `name`)
- `last_name` (o `surname`)
- `role`
- `email`
- `mobile` (o `whatsapp`)
- `notes`
- `status` (`active` / `inactive`)

Reglas:

1. Si la cuenta no existe/no está activa, la fila se omite.
2. Si falta nombre y apellido, la fila se omite.
3. Dedupe por `account + first_name + last_name + email + mobile`.

Template: `docs/import_contacts_template.csv`.

---

## 3) Predios (desde **Predios → Importar CSV**)

Encabezado exacto esperado (fila 1):

`account_name,site_name,site_address,site_city,requires_sheet,requires_certificate,status,site_notes`

Columnas soportadas:

- `account_name` (obligatorio, debe existir y estar activa)
- `site_name` (obligatorio)
- `site_address` (o `address`)
- `site_city` (o `city`)
- `requires_sheet` (`true/false`, `1/0`, `si/no`)
- `requires_certificate` (`true/false`, `1/0`, `si/no`)
- `status` (`active` / `inactive`)
- `site_notes` (o `notes`)

Reglas:

1. Si la cuenta no existe/no está activa, la fila se omite.
2. Dedupe por `account + site_name + site_address`.

Template: `docs/import_sites_template.csv`.
