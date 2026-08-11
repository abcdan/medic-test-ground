package example

import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import kotlinx.coroutines.delay
import kotlinx.serialization.Serializable

@Serializable
data class Team(val id: Int, val name: String)

@Serializable
data class Member(val id: Int, val name: String)

@Serializable
data class TeamResponse(val id: Int, val name: String, val members: List<Member>)

class TeamDirectory {
    suspend fun listTeams(): List<Team> {
        delay(20)
        return listOf(Team(1, "Platform"), Team(2, "Product"), Team(3, "Support"))
    }

    suspend fun listMembers(teamId: Int): List<Member> {
        delay(20)
        return when (teamId) {
            1 -> listOf(Member(1, "Alex"), Member(2, "Morgan"))
            2 -> listOf(Member(3, "Riley"))
            else -> listOf(Member(4, "Casey"))
        }
    }
}

fun main() {
    val directory = TeamDirectory()

    embeddedServer(Netty, port = 8080) {
        install(ContentNegotiation) {
            json()
        }

        routing {
            get("/teams") {
                val teams = directory.listTeams()
                val response = teams.map { team ->
                    val members = directory.listMembers(team.id)
                    TeamResponse(team.id, team.name, members)
                }

                call.respond(response)
            }
        }
    }.start(wait = true)
}
