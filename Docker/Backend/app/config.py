from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_port: int = 8200
    enable_banking_app_id: str = ""
    private_key_path: str = "/app/config/private.pem"
    openai_api_key: str = ""
    openai_base_url: str = ""
    # Token waarmee de brug op de host ijkpunten van niet-PSD2-rekeningen mag duwen.
    push_token: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
