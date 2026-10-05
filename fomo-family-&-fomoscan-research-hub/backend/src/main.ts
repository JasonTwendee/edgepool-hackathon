import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dotenv from 'dotenv';
import { AppModule } from './app.module.js';
import { getConfig } from './config/configuration.js';

dotenv.config();

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }),
  );
  const port = getConfig().port;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`[Backend NestJS] Running at http://0.0.0.0:${port}`);
}

void bootstrap();
