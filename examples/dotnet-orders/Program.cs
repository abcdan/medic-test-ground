var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<OrderRepository>();

var app = builder.Build();

app.MapGet("/orders", async (OrderRepository repository) =>
{
    var orders = await repository.ListOrdersAsync();
    var response = new List<OrderResponse>();

    foreach (var order in orders)
    {
        var customer = await repository.GetCustomerAsync(order.CustomerId);
        response.Add(new OrderResponse(order.Id, order.Total, customer));
    }

    return Results.Ok(response);
});

app.Run();

record Order(int Id, int CustomerId, decimal Total);
record Customer(int Id, string Name);
record OrderResponse(int Id, decimal Total, Customer Customer);

class OrderRepository
{
    private readonly IReadOnlyList<Order> _orders =
    [
        new(1001, 1, 29.95m),
        new(1002, 2, 84.50m),
        new(1003, 1, 12.00m)
    ];

    private readonly IReadOnlyList<Customer> _customers =
    [
        new(1, "Jordan"),
        new(2, "Taylor")
    ];

    public async Task<IReadOnlyList<Order>> ListOrdersAsync()
    {
        await Task.Delay(10);
        return _orders;
    }

    public async Task<Customer> GetCustomerAsync(int id)
    {
        await Task.Delay(10);
        return _customers.Single(customer => customer.Id == id);
    }
}
