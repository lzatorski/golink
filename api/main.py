from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, Request, Form
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.templating import Jinja2Templates
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

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")


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


# ── Protected API ─────────────────────────────────────────────────────────────

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


# ── Web UI ────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def root():
    return RedirectResponse("/ui/links")


@app.get("/ui/login", response_class=HTMLResponse, include_in_schema=False)
def ui_login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "user": None})


@app.post("/ui/login", response_class=HTMLResponse, include_in_schema=False)
def ui_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
):
    token = auth.authenticate(username, password)
    if not token:
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "user": None, "error": "Invalid username or password."},
            status_code=401,
        )
    response = RedirectResponse("/ui/links", status_code=303)
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
    return response


@app.get("/ui/logout", include_in_schema=False)
def ui_logout():
    response = RedirectResponse("/ui/login", status_code=303)
    response.delete_cookie("token")
    return response


@app.get("/ui/links", response_class=HTMLResponse, include_in_schema=False)
def ui_links(
    request: Request,
    db: Session = Depends(get_db),
    user: str = Depends(auth.get_web_user),
    success: str = None,
    error: str = None,
):
    if not user:
        return RedirectResponse("/ui/login", status_code=303)
    links = db.query(models.Link).order_by(models.Link.slug).all()
    return templates.TemplateResponse("links.html", {
        "request": request,
        "user": user,
        "links": links,
        "flash_success": success,
        "flash_error": error,
    })


@app.post("/ui/links", response_class=HTMLResponse, include_in_schema=False)
def ui_create_link(
    request: Request,
    db: Session = Depends(get_db),
    user: str = Depends(auth.get_web_user),
    slug: str = Form(...),
    url: str = Form(...),
    description: str = Form(""),
):
    if not user:
        return RedirectResponse("/ui/login", status_code=303)
    slug = slug.strip().lower()
    if not slug:
        return RedirectResponse("/ui/links?error=Slug+cannot+be+empty", status_code=303)
    if db.query(models.Link).filter(models.Link.slug == slug).first():
        return RedirectResponse(f"/ui/links?error=Slug+%27{slug}%27+already+exists", status_code=303)
    db.add(models.Link(slug=slug, url=url.strip(), description=description.strip()))
    db.commit()
    return RedirectResponse(f"/ui/links?success=go%2F{slug}+created", status_code=303)


@app.get("/ui/links/{slug}/edit", response_class=HTMLResponse, include_in_schema=False)
def ui_edit_page(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
    user: str = Depends(auth.get_web_user),
):
    if not user:
        return RedirectResponse("/ui/login", status_code=303)
    link = db.query(models.Link).filter(models.Link.slug == slug).first()
    if not link:
        return RedirectResponse("/ui/links?error=Link+not+found", status_code=303)
    return templates.TemplateResponse("edit.html", {"request": request, "user": user, "link": link})


@app.post("/ui/links/{slug}/edit", response_class=HTMLResponse, include_in_schema=False)
def ui_edit_link(
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
    user: str = Depends(auth.get_web_user),
    url: str = Form(...),
    description: str = Form(""),
):
    if not user:
        return RedirectResponse("/ui/login", status_code=303)
    link = db.query(models.Link).filter(models.Link.slug == slug).first()
    if not link:
        return RedirectResponse("/ui/links?error=Link+not+found", status_code=303)
    link.url = url.strip()
    link.description = description.strip()
    db.commit()
    return RedirectResponse(f"/ui/links?success=go%2F{slug}+updated", status_code=303)


@app.post("/ui/links/{slug}/delete", include_in_schema=False)
def ui_delete_link(
    slug: str,
    db: Session = Depends(get_db),
    user: str = Depends(auth.get_web_user),
):
    if not user:
        return RedirectResponse("/ui/login", status_code=303)
    link = db.query(models.Link).filter(models.Link.slug == slug).first()
    if link:
        db.delete(link)
        db.commit()
    return RedirectResponse(f"/ui/links?success=go%2F{slug}+deleted", status_code=303)
