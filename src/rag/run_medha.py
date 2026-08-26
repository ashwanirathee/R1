from fastapi import FastAPI
from src.routers.v1 import router as v1_router
# from src.routers.test2 import router as test2_router

app = FastAPI()
app.include_router(v1_router)
# app.include_router(test2_router)