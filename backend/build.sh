#!/usr/bin/env bash
set -o errexit
set -o nounset
python -m pip install -r requirements.txt
python manage.py collectstatic --noinput
# Migrations are a separate pre-deploy/start step; this build never changes data.
