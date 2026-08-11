import Vapor

struct Book: Content {
    let id: Int
    let title: String
    let authorID: Int
}

struct Author: Content {
    let id: Int
    let name: String
}

struct BookResponse: Content {
    let id: Int
    let title: String
    let author: Author?
}

actor LibraryStore {
    private let books = [
        Book(id: 1, title: "Northbound", authorID: 1),
        Book(id: 2, title: "Small Signals", authorID: 2),
        Book(id: 3, title: "The Long Weekend", authorID: 1)
    ]

    private let authors = [
        Author(id: 1, name: "Jamie Chen"),
        Author(id: 2, name: "Robin Patel")
    ]

    func listBooks() async throws -> [Book] {
        try await Task.sleep(nanoseconds: 15_000_000)
        return books
    }

    func findAuthor(id: Int) async throws -> Author? {
        try await Task.sleep(nanoseconds: 15_000_000)
        return authors.first { $0.id == id }
    }
}

let app = try await Application.make(.detect())
let store = LibraryStore()

app.get("books") { request async throws -> [BookResponse] in
    let books = try await store.listBooks()
    var response: [BookResponse] = []

    for book in books {
        let author = try await store.findAuthor(id: book.authorID)
        response.append(BookResponse(id: book.id, title: book.title, author: author))
    }

    return response
}

try await app.execute()
try await app.asyncShutdown()
