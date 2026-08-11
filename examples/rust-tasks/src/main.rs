use axum::{routing::get, Router};
use serde::Serialize;

#[derive(Serialize)]
struct Task {
    id: u32,
    title: String,
    completed: bool,
}

#[tokio::main]
async fn main() {
    let app = Router::new().route("/tasks", get(list_tasks));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("could not bind server");

    axum::serve(listener, app)
        .await
        .expect("server stopped unexpectedly");
}

async fn list_tasks() -> Json<Vec<Task>> {
    Json(vec![
        Task {
            id: 1,
            title: "Review roadmap".to_owned(),
            completed: true,
        },
        Task {
            id: 2,
            title: "Prepare demo".to_owned(),
            completed: false,
        },
    ])
}
