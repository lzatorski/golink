from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import models, schemas, auth
from .database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="GoLink API",
    description="Personal URL shortener service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Public ──────────────────────────────────────────────────────────────────

@app.get("/go/{slug}", tags=["redirect"], summary="Redirect to target URL")
def redirect(slug: str, db: Session = Depends(get_db)):
    link = db.query(models.Link).filter(models.Link.slug == slug).first()
    if not link:
        raise HTTPException(status_code=404, detail=f"No link found for slug '{slug}'")
    link.hit_count += 1
    db.commit()
    return RedirectResponse(url=link.url, status_code=302)


@app.post("/api/auth/token", response_model=schemas.TokenResponse, tags=["auth"])
def get_token(credentials: schemas.Credentials):
    token = auth.authenticate(credentials.username, credentials.password)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"access_token": token, "token_type": "bearer"}


# ── Protected ────────────────────────────────────────────────────────────────

@app.get("/api/links", response_model=list[schemas.LinkResponse], tags=["links"])
def list_links(
    db: Session = Depends(get_db),
    _: str = Depends(auth.verify_token),
):
    return db.query(models.Link).all()


@app.post("/api/links", response_model=schemas.LinkResponse, status_code=201, tags=["links"])
def create_link(
    link: schemas.LinkCreate,
    db: Session = Depends(get_db),
    _: str = Depends(auth.verify_token),
):
    if db.query(models.Link).filter(models.Link.slug == link.slug).first():
        raise HTTPException(status_code=409, detail=f"Slug '{link.slug}' already exists")
    db_link = models.Link(**link.model_dump())
    db.add(db_link)
    db.commit()
    db.refresh(db_link)
    return db_link


@app.put("/api/links/{slug}", response_model=schemas.LinkResponse, tags=["links"])
def update_link(
    slug: str,
    link: schemas.LinkUpdate,
    db: Session = Depends(get_db),
    _: str = Depends(auth.verify_token),
):
    db_link = db.query(models.Link).filter(models.Link.slug == slug).first()
    if not db_link:
        raise HTTPException(status_code=404, detail=f"No link found for slug '{slug}'")
    for key, value in link.model_dump(exclude_unset=True).items():
        setattr(db_link, key, value)
    db.commit()
    db.refresh(db_link)
    return db_link


@app.delete("/api/links/{slug}", status_code=204, tags=["links"])
def delete_link(
    slug: str,
    db: Session = Depends(get_db),
    _: str = Depends(auth.verify_token),
):
    db_link = db.query(models.Link).filter(models.Link.slug == slug).first()
    if not db_link:
        raise HTTPException(status_code=404, detail=f"No link found for slug '{slug}'")
    db.delete(db_link)
    db.commit()


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok"}
