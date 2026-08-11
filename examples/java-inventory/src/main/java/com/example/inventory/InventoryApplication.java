package com.example.inventory;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class InventoryApplication {
    public static void main(String[] args) {
        SpringApplication.run(InventoryApplication.class, args);
    }

    @GetMapping("/items")
    public List<InventoryItem> listItems() {
        return List.of(
            new InventoryItem(1, "Notebook", 42),
            new InventoryItem(2, "Marker", 18),
            new InventoryItem(3, "Envelope", 75)
        );
    }

    public record InventoryItem(int id, String name, int available) {}
}
