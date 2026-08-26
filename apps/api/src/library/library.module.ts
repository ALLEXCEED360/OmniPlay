import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { LibraryService } from './library.service.js';
import { LibraryController } from './library.controller.js';

@Module({
  // Playtime provenance depends on what each provider claims it can report,
  // so the library needs the registry to tell a real zero from an unknown.
  imports: [ProvidersModule],
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService],
})
export class LibraryModule {}
