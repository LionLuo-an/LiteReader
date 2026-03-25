// Mock data based on user scenario
const books = [
  {
    "id": 1,
    "title": "Book1.txt",
    "filepath": "F:\\Download\\Folder1\\Book1.txt",
    "is_public": 1,
    "lib_is_public": 1,
    "library_name": "TestLib",
    "relative_path": "Folder1/Book1.txt" // Expected from server
  },
  {
    "id": 2,
    "title": "Book2.txt",
    "filepath": "F:\\Download\\Folder2\\Book2.txt",
    "is_public": 1,
    "lib_is_public": 1,
    "library_name": "TestLib",
    "relative_path": "Folder2/Book2.txt"
  },
  {
    "id": 3,
    "title": "File.txt",
    "filepath": "F:\\Download\\File.txt",
    "is_public": 1,
    "lib_is_public": 1,
    "library_name": "TestLib",
    "relative_path": "File.txt"
  },
  {
      "id": 4,
      "title": "Outside.txt",
      "filepath": "X:\\Other\\Outside.txt",
      "is_public": 1,
      "lib_is_public": 0,
      "library_name": null,
      "relative_path": "Outside.txt"
  }
];

let currentPath = [];

// Simulation of fetchPublicBooks logic
const processedBooks = books
    .filter(b => b.is_public == 1 || b.lib_is_public == 1)
    .map(b => ({
        ...b,
        relative_path: (b.relative_path || '')
            .replace(/\\/g, '/')
            .replace(/^\.\//, '')
            .replace(/^\//, '')
    }));

console.log("Processed Books:", JSON.stringify(processedBooks, null, 2));

function getDisplayItems() {
    console.log(`\n--- View: ${currentPath.length === 0 ? 'Root' : currentPath.join('/')} ---`);
    
    // 2. Root View
    if (currentPath.length === 0) {
        const librariesMap = new Map();
        const rootBooks = [];

        processedBooks.forEach(b => {
            if (b.lib_is_public === 1) {
                if (!librariesMap.has(b.library_name)) {
                    librariesMap.set(b.library_name, {
                        name: b.library_name,
                        count: 0,
                        isLibrary: true
                    });
                }
                librariesMap.get(b.library_name).count++;
            } else {
                rootBooks.push(b);
            }
        });
        
        const folders = Array.from(librariesMap.values());
        return { folders, books: rootBooks };
    }

    // 3. Inside a Library/Folder
    const libraryName = currentPath[0];
    const relativeFolderParts = currentPath.slice(1); 
    const currentRelativePrefix = relativeFolderParts.length > 0 
        ? relativeFolderParts.join('/') + '/' 
        : '';

    console.log("Current Prefix:", currentRelativePrefix);

    const subFoldersMap = new Map();
    const currentBooks = [];

    processedBooks.forEach(b => {
        if (b.library_name !== libraryName) return;

        if (b.relative_path.startsWith(currentRelativePrefix)) {
            const remainingPath = b.relative_path.substring(currentRelativePrefix.length);
            const parts = remainingPath.split('/');
            
            console.log(`  Book ${b.title}: rem="${remainingPath}", parts=${JSON.stringify(parts)}`);

            if (parts.length === 1) {
                currentBooks.push(b);
            } else {
                const subFolderName = parts[0];
                if (!subFoldersMap.has(subFolderName)) {
                    subFoldersMap.set(subFolderName, {
                        name: subFolderName,
                        count: 0
                    });
                }
                subFoldersMap.get(subFolderName).count++;
            }
        }
    });

    const folders = Array.from(subFoldersMap.values());
    return { folders, books: currentBooks };
}

// 1. Root
let res = getDisplayItems();
console.log("Folders:", res.folders.map(f => f.name));
console.log("Books:", res.books.map(b => b.title));

// 2. Enter Library "TestLib"
currentPath = ['TestLib'];
res = getDisplayItems();
console.log("Folders:", res.folders.map(f => f.name));
console.log("Books:", res.books.map(b => b.title));

// 3. Enter Folder "Folder1"
currentPath = ['TestLib', 'Folder1'];
res = getDisplayItems();
console.log("Folders:", res.folders.map(f => f.name));
console.log("Books:", res.books.map(b => b.title));
