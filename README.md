## build locally

```
npm run build
npx serve public
```

## merch branch withour pr
dev -> main

```
git checkout main
git pull origin main
git merge dev
git push origin main
```

## sync dev to main

remove everything and sync to main
```
git checkout dev
git fetch origin
git reset --hard origin/main
git push origin dev --force
```

kept dev commit
```
git checkout dev
git fetch origin
git rebase origin/main
git push origin dev --force-with-lease
```