#!/usr/bin/env bash
GENERATED_DIR="src/database/_generated"

rm -rf $GENERATED_DIR

yarn prisma generate --schema=prisma

# generate index.ts for re-exports
echo "// auto-generated" > $GENERATED_DIR/index.ts
echo "" >> $GENERATED_DIR/index.ts

# find all .ts files in database directory, excluding internal folder and index.ts itself
find $GENERATED_DIR -name "*.ts" -not -path "*/internal/*" -not -name "index.ts" | while read -r file; do
    # convert file path to module path (remove $GENERATED_DIR/ prefix and .ts suffix)
    module_path=$(echo "$file" | sed "s|$GENERATED_DIR/||" | sed 's|\.ts$||')
    
    # add export statement
    echo "export * from \"./$module_path\"" >> $GENERATED_DIR/index.ts
done

