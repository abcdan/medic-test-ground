plugins {
    kotlin("jvm") version "2.2.0"
    kotlin("plugin.serialization") version "2.2.0"
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-core-jvm:3.2.2")
    implementation("io.ktor:ktor-server-netty-jvm:3.2.2")
    implementation("io.ktor:ktor-server-content-negotiation-jvm:3.2.2")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm:3.2.2")
}

application {
    mainClass.set("example.ApplicationKt")
}
