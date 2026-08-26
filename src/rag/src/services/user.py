import json
from pathlib import Path
from fastapi import HTTPException

USERS_FILE = Path("data/users.json")


class UserDataService:
    def __init__(self):
        pass

    def get_user_by_token(self, token: str) -> dict | None:
        users = self.load_users()
        for user in users:
            tokens = user.get("tokens", [])
            for t in tokens:
                if t.get("token") == token:
                    return user
        return None

    def validate_token(self, token: str) -> bool:
        return self.get_user_by_token(token) is not None

    def get_collection_for_token(self, token: str) -> str | None:
        user = self.get_user_by_token(token)
        return user.get("collection_name") if user else None

    def get_user_folder(self, token: str) -> str | None:
        user = self.get_user_by_token(token)
        return user.get("folder_path") if user else None

    def load_users(self) -> list[dict]:
        if not USERS_FILE.exists():
            return []

        with USERS_FILE.open("r", encoding="utf-8") as f:
            try:
                data = json.load(f)
                if isinstance(data, list):
                    return data
                return []
            except json.JSONDecodeError:
                return []

    def save_users(self, users: list[dict]) -> None:
        with USERS_FILE.open("w", encoding="utf-8") as f:
            json.dump(users, f, indent=2)

    def require_collection_name(self, token: str) -> str:
        if not self.validate_token(token):
            raise HTTPException(status_code=401, detail="invalid_token")

        collection_name = self.get_collection_for_token(token)
        if not collection_name:
            raise HTTPException(status_code=404, detail="collection_not_found")

        return collection_name
    
    def require_user_folder_name(self, token: str) -> str:
        if not self.validate_token(token):
            raise HTTPException(status_code=401, detail="invalid_token")
        
        user_folder = self.get_user_folder(token)
        if not user_folder:
            raise HTTPException(status_code=404, detail="collection_not_found")

        return user_folder
    
    def require_user(self, token: str) -> dict:
        if not self.validate_token(token):
            raise HTTPException(status_code=401, detail="invalid_token")

        user = self.get_user_by_token(token)
        if not user:
            raise HTTPException(status_code=404, detail="user_not_found")

        return user
    
    def validate_user(self, username:str, password:str):
        users = self.load_users()
        for user in users:
            if user.get("username") == username and user.get("password") == password:
                return user
        return None

    def update_user(self, user: dict) -> None:
        users = self.load_users()
        for i, u in enumerate(users):
            if u.get("username") == user.get("username"):
                users[i] = user
                self.save_users(users)
                return 0

        return -1

    def delete_user(self, username: str, password: str):
        users = self.load_users()
        
        for user in users:
            if user.get("username") == username and user.get("password") == password:
                users.remove(user)
                self.save_users(users)
                return 0

        return -1
    
    def get_token_scopes(self, token: str) -> list[str] | None:
        user = self.get_user_by_token(token)
        if not user:
            return None
        
        tokens = user.get("tokens", [])
        for t in tokens:
            if t.get("token") == token:
                return t.get("scopes", [])
        return None



user_service = UserDataService()


def get_user_data_service() -> UserDataService:
    return user_service
