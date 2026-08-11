<?php

declare(strict_types=1);

namespace App;

use Psr\Http\Message\ServerRequestInterface;
use Slim\Factory\AppFactory;

require dirname(__DIR__) . '/vendor/autoload.php';

$app = AppFactory::create();

$app->get('/status', function (ServerRequestInterface $request, ResponseInterface $response): ResponseInterface {
    $payload = json_encode([
        'status' => 'ok',
        'service' => 'status-api',
        'timestamp' => gmdate(DATE_ATOM),
    ], JSON_THROW_ON_ERROR);

    $response->getBody()->write($payload);

    return $response->withHeader('Content-Type', 'application/json');
});

$app->run();
