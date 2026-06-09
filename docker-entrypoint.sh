#!/bin/bash
set -e

CONFIG_DIR="/app/config"

# Look for any existing .pem file
shopt -s nullglob
PEM_FILES=("$CONFIG_DIR"/*.pem)
shopt -u nullglob

if [ ${#PEM_FILES[@]} -gt 0 ]; then
    KEY_TO_USE="${PEM_FILES[0]}"
    echo "Using existing private key: $KEY_TO_USE"
else
    KEY_TO_USE="$CONFIG_DIR/generated-private.pem"
    PUBLIC_CERT="$CONFIG_DIR/public.crt"

    echo "No .pem file found. Generating a new 4096-bit RSA key..."
    openssl genrsa -out "$KEY_TO_USE" 4096

    openssl req -new -x509 -days 365 \
        -key "$KEY_TO_USE" \
        -out "$PUBLIC_CERT" \
        -subj "/C=FI/ST=Uusima/L=Helsinki/O=BankingDashboard/CN=localhost"

    echo ""
    echo "Public key (PEM format) — upload this to Enable Banking:"
    echo "============================================================"
    cat "$PUBLIC_CERT"
    echo "============================================================"
fi

# Pass the key path to the app via env var (overrides .env setting)
exec env PRIVATE_KEY_PATH="$KEY_TO_USE" "$@"
