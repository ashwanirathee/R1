import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class MedhaClient:
    base_url: str
    token: str
    timeout: float = 2.0

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url.rstrip('/')}{path}"
        body = None
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(
            url=url,
            data=body,
            headers=headers,
            method=method,
        )
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def health(self) -> dict[str, Any]:
        url = f"{self.base_url.rstrip('/')}/health"
        with urllib.request.urlopen(url, timeout=self.timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def list_documents(self, collections: list[str] | None = None) -> dict[str, Any]:
        path = "/v1/documents"
        if collections:
            query = "&".join(f"collection={collection}" for collection in collections)
            path = f"{path}?{query}"
        return self._request("GET", path)

    def get_document(self, document_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/documents/{document_id}")

    def query(
        self,
        query: str,
        limit: int = 5,
        collections: list[str] | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"query": query, "limit": limit}
        if collections:
            payload["collections"] = collections
        return self._request("POST", "/v1/query", payload=payload)

    def reload(self) -> dict[str, Any]:
        return self._request("POST", "/v1/admin/reload", payload={})


LibrarianClient = MedhaClient
