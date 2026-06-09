from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_port: int = 8200
    enable_banking_app_id: str = ""
    private_key_path: str = "/app/config/private.pem"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
