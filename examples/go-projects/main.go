package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type Project struct {
	ID      int    `json:"id"`
	Name    string `json:"name"`
	OwnerID int    `json:"-"`
}

type Owner struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

type ProjectResponse struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Owner Owner  `json:"owner"`
}

type Repository struct {
	projects []Project
	owners   []Owner
}

func (r Repository) ListProjects() []Project {
	return r.projects
}

func (r Repository) FindOwner(id int) Owner {
	for _, owner := range r.owners {
		if owner.ID == id {
			return owner
		}
	}

	return Owner{}
}

func main() {
	repository := Repository{
		projects: []Project{{1, "Launch", 1}, {2, "Migration", 2}, {3, "Mobile", 1}},
		owners:   []Owner{{1, "Avery"}, {2, "Sam"}},
	}

	http.HandleFunc("/projects", func(w http.ResponseWriter, r *http.Request) {
		projects := repository.ListProjects()
		response := make([]ProjectResponse, 0, len(projects))

		for _, project := range projects {
			owner := repository.FindOwner(project.OwnerID)
			response = append(response, ProjectResponse{ID: project.ID, Name: project.Name, Owner: owner})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	})

	log.Println("projects API listening on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
