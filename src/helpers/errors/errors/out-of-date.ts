import { createError, ErrorCode } from '../index.js';

export const OutOfDateError = createError(
	ErrorCode.OutOfDate,
	'Operation could not be executed: Your current instance of yourpartner is out of date.',
	503,
);
