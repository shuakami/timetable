#!/usr/bin/env bash
# 用 GitHub REST API 建私有仓库并把当前目录以单个提交推到 main。
# 不用 gh CLI。提交人固定。token 只从 GH_TOKEN 环境变量读取。
#
#   GH_TOKEN=ghp_xxx scripts/push-github.sh <repo-name> ["commit message"]
set -euo pipefail

REPO="${1:?repo name}"
MSG="${2:-Initial commit}"
: "${GH_TOKEN:?GH_TOKEN 未设置}"
NAME="shuakami"
EMAIL="shuakami@sdjz.wiki"
API="https://api.github.com"

auth=(-H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

LOGIN="$(curl -fsS "${auth[@]}" "$API/user" | python3 -c 'import json,sys;print(json.load(sys.stdin)["login"])')"
echo "user: $LOGIN"

if ! curl -fsS "${auth[@]}" "$API/repos/$LOGIN/$REPO" >/dev/null 2>&1; then
  curl -fsS "${auth[@]}" -X POST "$API/user/repos" \
    -d "{\"name\":\"$REPO\",\"private\":true,\"auto_init\":false}" >/dev/null
  echo "created private repo $LOGIN/$REPO"
fi

cd "$(dirname "$0")/.."
[ -d .git ] || git init -q -b main
git checkout -q -B main
git add -A
export GIT_AUTHOR_NAME="$NAME" GIT_AUTHOR_EMAIL="$EMAIL" GIT_COMMITTER_NAME="$NAME" GIT_COMMITTER_EMAIL="$EMAIL"
git -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "$MSG" || echo "nothing to commit"

# token 走 header，不写进 remote url，不落盘
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
git -c "http.extraHeader=Authorization: Basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)" \
  push -q "https://github.com/$LOGIN/$REPO.git" main:main
echo "pushed https://github.com/$LOGIN/$REPO"
