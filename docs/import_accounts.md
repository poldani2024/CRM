# Importación masiva de Cuentas y Predios

## Formato del archivo
Desde **Cuentas → Importar CSV** podés subir un archivo `.csv` con estas columnas:

- `account_name` (obligatorio)
- `account_type` (bank, building, warehouse, store, plant, business, commercial, residential)
- `visit_frequency_per_month` (número, default `1`)
- `stage` (prospect, offer_sent, negotiation, account_active, closed)
- `phone`
- `notes`
- `site_name` (si lo completás, crea predio)
- `site_address`
- `site_city`
- `site_notes`

## Reglas

1. Si la cuenta no existe, se crea.
2. Si la cuenta ya existe (mismo nombre), no se duplica.
3. Cada fila puede crear un predio para la cuenta.
4. Si un predio con mismo `account + site_name + site_address` ya existe, no se duplica.
5. `visit_frequency_per_month` se guarda como frecuencia mensual.

## Caso de cuentas con múltiples predios

Repetí `account_name` en varias filas y cambiá `site_name`/`site_address`.

## Ejemplo

Usá `docs/import_accounts_template.csv` como base.
