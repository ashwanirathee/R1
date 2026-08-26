import chromadb


class ChromaService:
    def __init__(self):
        self.client = chromadb.HttpClient(host="localhost", port=8000)

    def create_collection(self, name: str):
        try:
            self.client.create_collection(name=name)
        except chromadb.errors.CollectionAlreadyExistsException:
            return -1
        return 0

    def list_collections(self):
        return self.client.list_collections()

    def get_collection(self, name: str):
        return self.client.get_or_create_collection(name=name)

    def get_collection_data(self, name: str, scopes: list[str] | None = None):
        collection = self.get_collection(name)

        kwargs = {
            "include": ["documents", "metadatas"]
        }

        if scopes:
            kwargs["where"] = {"scope": {"$in": scopes}}

        return collection.get(**kwargs)
    
    def query(
        self,
        collection_name: str,
        query_texts: list[str],
        n_results: int = 5,
        decided_scopes: list[str] | None = None,
    ):
        collection = self.get_collection(collection_name)

        query_kwargs = {
            "query_texts": query_texts,
            "n_results": n_results,
        }

        if decided_scopes:
            query_kwargs["where"] = {
                "scope": {"$in": decided_scopes}
            }

        return collection.query(**query_kwargs)
    
    def upsert_documents(
        self,
        collection_name: str,
        documents: list[str],
        ids: list[str],
        metadatas: list[dict] | None = None,
    ):
        collection = self.get_collection(collection_name)
        collection.upsert(documents=documents, ids=ids, metadatas=metadatas)
        return 0

    def delete_collection(self, collection_name: str):
        self.client.delete_collection(name=collection_name)
        return 0


    def get_documents(
        self,
        collection_name: str,
        where: dict | None = None,
        include: list[str] | None = None,
    ):
        collection = self.get_collection(collection_name)
        if include is None:
            include = ["documents", "metadatas"]
        return collection.get(where=where, include=include)
    
    def get_document_metadatas(self, collection_name: str, document_id: str) -> list[dict]:
        result = self.get_documents(
            collection_name=collection_name,
            where={"document_id": document_id},
            include=["metadatas"],
        )
        return result.get("metadatas", []) or []
    
    def delete_documents(
        self,
        collection_name: str,
        ids: list[str] | None = None,
        where: dict | None = None,
    ):
        collection = self.get_collection(collection_name)
        if ids is None and where is None:
            raise ValueError("Either ids or where must be provided")
        collection.delete(ids=ids, where=where)

    def delete_by_document_id(self, collection_name: str, document_id: str):
        self.delete_documents(
            collection_name=collection_name,
            where={"document_id": document_id},
        )

chroma_service = ChromaService()


def get_chroma_service() -> ChromaService:
    return chroma_service
