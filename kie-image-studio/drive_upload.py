"""
Upload d'une image vers Google Drive pour Kie Image Studio.

- Dossier « Kie Studio » (créé au premier usage, partagé « tous ceux qui ont le lien »)
- Retourne un lien direct téléchargeable par les APIs :
  https://drive.google.com/uc?export=download&id=<ID>

Usage : py drive_upload.py <chemin_fichier> <nom_fichier>
Sortie : ligne "RESULT:{...json...}"
"""

import io
import json
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from google_auth import get_credentials  # noqa: E402
from googleapiclient.discovery import build  # noqa: E402
from googleapiclient.http import MediaIoBaseUpload  # noqa: E402

FOLDER_NAME = "Kie Studio"


def find_or_create_folder(drive) -> str:
    q = (
        f"name = '{FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' "
        "and trashed = false"
    )
    res = drive.files().list(q=q, fields="files(id)", pageSize=1).execute()
    items = res.get("files", [])
    if items:
        return items[0]["id"]

    folder = (
        drive.files()
        .create(
            body={"name": FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"},
            fields="id",
        )
        .execute()
    )
    folder_id = folder["id"]
    # Dossier public (lecture) — les fichiers héritent du partage.
    drive.permissions().create(
        fileId=folder_id, body={"role": "reader", "type": "anyone"}
    ).execute()
    return folder_id


def main() -> None:
    file_path, file_name = sys.argv[1], sys.argv[2]
    data = Path(file_path).read_bytes()
    mime = mimetypes.guess_type(file_name)[0] or "image/png"

    creds = get_credentials()
    drive = build("drive", "v3", credentials=creds)

    folder_id = find_or_create_folder(drive)
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=mime, resumable=False)
    file = (
        drive.files()
        .create(
            body={"name": file_name, "parents": [folder_id]},
            media_body=media,
            fields="id",
        )
        .execute()
    )
    file_id = file["id"]
    # Par sécurité : partage explicite du fichier lui-même.
    drive.permissions().create(
        fileId=file_id, body={"role": "reader", "type": "anyone"}
    ).execute()

    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    print("RESULT:" + json.dumps({"id": file_id, "url": url}))


if __name__ == "__main__":
    main()
